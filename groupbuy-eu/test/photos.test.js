import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDb, createRepo } from '../src/db.js';
import { systemClock, hmac } from '../src/util.js';
import { publicRoutes } from '../src/routes/public.js';
import { adminRoutes } from '../src/routes/admin.js';
import { MAIN_SIZE, THUMB_SIZE, createPhotoStore, loadSharp, optimizeStoredPhotos } from '../src/photos.js';

const sharp = await loadSharp();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gb-photos-'));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

// A real 2400 × 1800 photo with camera metadata and a GPS position, rotated by its EXIF tag.
const cameraPhoto = () =>
  sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#c05621' } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExif({ IFD0: { Make: 'PhoneCo' }, GPS: { GPSLatitudeRef: 'N', GPSLatitude: '59/1 26/1 0/1' } })
    .toBuffer();

test('uploads become a resized JPEG and a WebP thumbnail, turned upright, without metadata', { skip: !sharp && 'sharp is not installed' }, async () => {
  const store = createPhotoStore(tmp());
  const original = await cameraPhoto();
  assert.ok((await sharp(original).metadata()).exif, 'the test photo has metadata');
  const out = await store.store(original);
  assert.match(out.filename, /^[a-f0-9]{24}\.jpg$/);
  assert.match(out.thumb, /^[a-f0-9]{24}-sm\.webp$/);
  assert.equal(out.filename.slice(0, 24), out.thumb.slice(0, 24));
  const main = await sharp(path.join(store.dir, out.filename)).metadata();
  // Orientation 6 = rotated 90°: the stored photo is upright (portrait) and at most 1600 px.
  assert.deepEqual([main.width, main.height], [1200, MAIN_SIZE]);
  assert.deepEqual([out.width, out.height], [1200, 1600]);
  assert.equal(main.format, 'jpeg');
  assert.equal(main.exif, undefined, 'no camera data or GPS position');
  const thumb = await sharp(path.join(store.dir, out.thumb)).metadata();
  assert.equal(thumb.format, 'webp');
  assert.equal(Math.max(thumb.width, thumb.height), THUMB_SIZE);
  assert.ok(fs.statSync(path.join(store.dir, out.filename)).size < original.length);

  // Small photos aren't enlarged; GIFs keep their file (and animation) with a WebP thumbnail.
  const small = await store.store(await sharp({ create: { width: 300, height: 200, channels: 3, background: '#000' } }).png().toBuffer());
  assert.deepEqual([small.width, small.height], [300, 200]);
  const gif = await store.store(await sharp({ create: { width: 40, height: 40, channels: 3, background: '#0f0' } }).gif().toBuffer());
  assert.match(gif.filename, /\.gif$/);
  assert.match(gif.thumb, /-sm\.webp$/);

  // Copies and removal handle both files.
  const copy = store.duplicate(out);
  assert.notEqual(copy.filename, out.filename);
  assert.ok(fs.existsSync(path.join(store.dir, copy.thumb)));
  store.remove(out.filename, out.thumb);
  assert.equal(fs.existsSync(path.join(store.dir, out.filename)), false);
  assert.equal(fs.existsSync(path.join(store.dir, out.thumb)), false);
  assert.ok(fs.existsSync(path.join(store.dir, copy.filename)));
});

test('without sharp, or for files it cannot read, the original is kept', async () => {
  const plain = createPhotoStore(tmp(), { sharp: null });
  const out = await plain.store(PNG);
  assert.match(out.filename, /\.png$/);
  assert.equal(out.thumb, '');
  assert.deepEqual(fs.readFileSync(path.join(plain.dir, out.filename)), PNG);
  if (sharp) {
    const broken = await createPhotoStore(tmp()).store(PNG); // a PNG signature with no image inside
    assert.match(broken.filename, /\.png$/);
    assert.equal(broken.thumb, '');
  }
  await assert.rejects(plain.store(Buffer.from('<svg onload=alert(1)>')), /Unsupported/);
});

test('older photos get shop-ready copies once; the original files stay', { skip: !sharp && 'sharp is not installed' }, async () => {
  const dir = tmp();
  const repo = createRepo(openDb(path.join(dir, 'db.sqlite')));
  const photos = createPhotoStore(path.join(dir, 'uploads'));
  const deal = repo.insertDeal({ slug: 'mug-1', product_name: 'Mug', description: '', image_url: '', price_cents: 900, tax_code: 'txcd_99999999', min_buyers: 2, deadline: inDays(2), created_at: new Date().toISOString() });
  const legacy = photos.save(await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#123' } }).png().toBuffer());
  repo.addPhoto(deal.id, legacy, new Date().toISOString());
  assert.equal(await optimizeStoredPhotos({ repo, photos, log: {} }), 1);
  const [row] = repo.photosForDeal(deal.id);
  assert.match(row.filename, /\.jpg$/);
  assert.ok(row.thumb);
  assert.equal(row.width, 1600);
  assert.ok(fs.existsSync(path.join(photos.dir, legacy)), 'links already shared keep working');
  assert.equal(await optimizeStoredPhotos({ repo, photos, log: {} }), 0, 'nothing left to do');
});

test('admin: reorder photos, describe them, and the shop shows the gallery with thumbnails', async (t) => {
  const dir = tmp();
  const config = {
    baseUrl: 'https://shop.test', adminUser: 'admin', adminPassword: 'secret-pw', appSecret: 'test-secret-0123456789abcdef',
    defaultTaxCode: 'txcd_99999999', uploadDir: path.join(dir, 'uploads'), trustProxy: false,
    business: { name: 'Test Shop', address: 'Street 1', email: 'shop@example.com', vatId: 'EE1', registration: 'R1', supervisoryAuthority: 'DPA' },
  };
  const repo = createRepo(openDb(path.join(dir, 'db.sqlite')));
  const photos = createPhotoStore(config.uploadDir, { sharp: null });
  const server = createApp({ config, repo, clock: systemClock, photos, routes: [publicRoutes, adminRoutes] }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:secret-pw').toString('base64') };
  const post = (p, fields) =>
    fetch(base + p, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: hmac(config.appSecret, 'admin-csrf'), ...fields }), redirect: 'manual' });

  const deal = repo.insertDeal({ slug: 'lamp-1', product_name: 'Oak lamp', description: '', image_url: '', price_cents: 4900, tax_code: 'txcd_99999999', min_buyers: 3, deadline: inDays(3), created_at: new Date().toISOString() });
  const now = new Date().toISOString();
  repo.addPhoto(deal.id, { filename: photos.save(PNG), thumb: 'aaaaaaaaaaaaaaaaaaaaaaaa-sm.webp', width: 1600, height: 1200 }, now);
  repo.addPhoto(deal.id, photos.save(PNG), now);
  repo.addPhoto(deal.id, photos.save(PNG), now);
  const [a, b, c] = repo.photosForDeal(deal.id);

  assert.equal((await post(`/admin/photos/${c.id}/move`, { dir: 'earlier' })).status, 303);
  assert.deepEqual(repo.photosForDeal(deal.id).map((p) => p.id), [a.id, c.id, b.id]);
  await post(`/admin/photos/${c.id}/move`, { dir: 'earlier' });
  assert.deepEqual(repo.photosForDeal(deal.id).map((p) => p.id), [c.id, a.id, b.id], 'now the cover');
  const end = await post(`/admin/photos/${b.id}/move`, { dir: 'later' });
  assert.match(decodeURIComponent(end.headers.get('location')), /already at the end/);

  await post(`/admin/photos/${a.id}/alt`, { alt: '  The lamp   on a desk  ' });
  assert.equal(repo.photoById(a.id).alt, 'The lamp on a desk');
  const admin = await (await fetch(`${base}/admin/deals/${deal.id}`, { headers: auth })).text();
  assert.match(admin, /value="The lamp on a desk"/);
  assert.match(admin, /aria-label="Move photo 1 earlier" disabled/);

  const page = await (await fetch(`${base}/deals/lamp-1?lang=en`)).text();
  assert.match(page, /alt="The lamp on a desk" width="1600" height="1200"/);
  assert.match(page, /alt="Oak lamp"/, 'the cover without a description uses the product name');
  assert.match(page, /src="\/uploads\/aaaaaaaaaaaaaaaaaaaaaaaa-sm.webp"/, 'thumbnails in the strip');
  assert.match(page, /<dialog class="lightbox"/);
  assert.match(page, /aria-label="Next photo"/);
  assert.match(page, /1 \/ 3/);
  const home = await (await fetch(`${base}/?lang=en`)).text();
  assert.match(home, /deal-card-media[\s\S]*?<img src="\/uploads\/[a-f0-9]{24}\.png"/, 'cover without thumbnail falls back to the main file');
});
