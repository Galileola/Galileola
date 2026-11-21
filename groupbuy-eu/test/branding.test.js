import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDb, createRepo } from '../src/db.js';
import { systemClock, hmac } from '../src/util.js';
import { publicRoutes } from '../src/routes/public.js';
import { seoRoutes } from '../src/routes/seo.js';
import { adminRoutes } from '../src/routes/admin.js';
import { createPhotoStore, loadSharp } from '../src/photos.js';
import { verificationCode } from '../src/branding.js';

const sharp = await loadSharp();

test('verification codes are taken from the code or the whole meta tag', () => {
  assert.equal(verificationCode('abcDEF_123-xyz'), 'abcDEF_123-xyz');
  assert.equal(verificationCode('<meta name="google-site-verification" content="Zx9_k-Q" />'), 'Zx9_k-Q');
  assert.equal(verificationCode(''), '');
  assert.equal(verificationCode('"><script>'), null);
});

async function startApp({ business } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-branding-'));
  const config = {
    baseUrl: 'https://shop.test', adminUser: 'admin', adminPassword: 'secret-pw', appSecret: 'test-secret-0123456789abcdef',
    defaultTaxCode: 'txcd_99999999', uploadDir: path.join(dir, 'uploads'), trustProxy: false, contentLanguage: 'en',
    business: business ?? { name: '[Your company name]', address: '[Street]', email: '[contact@example.com]', vatId: '[EU VAT number]', registration: '[Register]', supervisoryAuthority: '[DPA]' },
  };
  const repo = createRepo(openDb(path.join(dir, 'db.sqlite')));
  const server = createApp({ config, repo, clock: systemClock, photos: createPhotoStore(config.uploadDir), routes: [seoRoutes, publicRoutes, adminRoutes] }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:secret-pw').toString('base64') };
  const csrf = hmac(config.appSecret, 'admin-csrf');
  const post = (p, fields) =>
    fetch(base + p, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, ...fields }), redirect: 'manual' });
  const upload = (p, buffer, type = 'image/png') => {
    const form = new FormData();
    form.append('_csrf', csrf);
    form.append('image', new Blob([buffer], { type }), 'image.png');
    return fetch(base + p, { method: 'POST', headers: auth, body: form, redirect: 'manual' });
  };
  const get = async (p, headers = {}) => (await fetch(base + p, { headers })).text();
  return { base, auth, repo, config, post, upload, get, close: () => server.close() };
}

test('every page has icons, a manifest and a share picture, even before any branding is set', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const home = await app.get('/?lang=en');
  assert.match(home, /<link rel="icon" href="\/static\/icons\/favicon.svg" type="image\/svg\+xml">/);
  assert.match(home, /<link rel="apple-touch-icon" href="\/static\/icons\/apple-touch-icon.png">/);
  assert.match(home, /<link rel="manifest" href="\/manifest.webmanifest">/);
  assert.match(home, /og:image" content="https:\/\/shop.test\/static\/icons\/share-default.jpg"/);
  assert.match(home, /twitter:card" content="summary_large_image"/);
  assert.match(home, /"@type":"WebSite"[\s\S]*"SearchAction"/);
  assert.match(home, /<title>Deals · Group Buy<\/title>/);
  assert.doesNotMatch(home, /google-site-verification/);

  const manifest = await (await fetch(`${app.base}/manifest.webmanifest`)).json();
  assert.equal(manifest.name, 'Group Buy');
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(manifest.icons.map((i) => i.sizes), ['192x192', '512x512', '512x512']);
  const fav = await fetch(`${app.base}/favicon.ico`, { redirect: 'manual' });
  assert.equal(fav.status, 301);
  assert.equal(fav.headers.get('location'), '/static/icons/favicon-48.png');
  for (const f of ['favicon.svg', 'favicon-48.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'share-default.jpg']) {
    assert.equal((await fetch(`${app.base}/static/icons/${f}`)).status, 200, f);
  }
});

test('admin: shop name, home search title and description, and verification codes', async (t) => {
  const app = await startApp({ business: { name: 'SEK Digital OÜ', address: 'A', email: 'a@b.ee', vatId: 'EE1', registration: 'R', supervisoryAuthority: 'D' } });
  t.after(app.close);
  assert.match(await app.get('/?lang=en'), /<title>Deals · SEK Digital OÜ<\/title>/, 'the company name until a shop name is set');
  assert.match(await app.get('/admin/settings', app.auth), /href="\/admin\/branding"/);
  assert.match(await app.get('/admin/branding', app.auth), /Branding &amp; search/);

  const bad = await app.post('/admin/branding', { googleVerification: '"><script>' });
  assert.equal(bad.status, 422);

  const r = await app.post('/admin/branding', {
    shopName: 'SEK Deals', homeTitle: 'SEK Deals – group buying in Estonia', homeDescription: 'Join a group deal and pay less.',
    googleVerification: '<meta name="google-site-verification" content="g00gleC0de" />', bingVerification: 'B1NG',
  });
  assert.equal(r.status, 303);
  const home = await app.get('/?lang=en');
  assert.match(home, /<title>SEK Deals – group buying in Estonia<\/title>/);
  assert.match(home, /name="description" content="Join a group deal and pay less."/);
  assert.match(home, /og:site_name" content="SEK Deals"/);
  assert.match(home, /<meta name="google-site-verification" content="g00gleC0de">/);
  assert.match(home, /<meta name="msvalidate.01" content="B1NG">/);
  assert.match(home, /class="brand" href="\/">[\s\S]*?SEK Deals<\/a>/);
  // Other languages keep their translated slogan.
  assert.match(await app.get('/?lang=de'), /<title>[^<]*· SEK Deals<\/title>/);
  assert.doesNotMatch(await app.get('/admin', app.auth), /google-site-verification/, 'not on admin pages');
  assert.equal((await (await fetch(`${app.base}/manifest.webmanifest`)).json()).name, 'SEK Deals');
});

test('admin: logo and share picture uploads', { skip: !sharp && 'sharp is not installed' }, async (t) => {
  const app = await startApp();
  t.after(app.close);
  const logo = await sharp({ create: { width: 800, height: 600, channels: 4, background: { r: 200, g: 30, b: 120, alpha: 1 } } }).png().toBuffer();
  const r = await app.upload('/admin/branding/logo', logo);
  assert.equal(r.status, 303);
  assert.match(decodeURIComponent(r.headers.get('location')), /Logo saved/);
  const home = await app.get('/?lang=en');
  const logoUrl = home.match(/<img class="brand-logo" src="(\/uploads\/[a-f0-9]{24}-logo\.png)"/)?.[1];
  assert.ok(logoUrl, 'logo in the header');
  const apple = home.match(/<link rel="apple-touch-icon" href="([^"]+)"/)[1];
  assert.match(apple, /-logo-180\.png$/);
  const icon = await sharp(Buffer.from(await (await fetch(app.base + apple)).arrayBuffer())).metadata();
  assert.deepEqual([icon.width, icon.height, icon.hasAlpha], [180, 180, false]);
  assert.doesNotMatch(home, /favicon.svg/);
  const manifest = await (await fetch(`${app.base}/manifest.webmanifest`)).json();
  assert.match(manifest.icons[1].src, /-logo-512\.png$/);

  const notImage = await app.upload('/admin/branding/logo', Buffer.from('hello'), 'text/plain');
  assert.match(decodeURIComponent(notImage.headers.get('location')), /PNG, JPG, WebP or GIF/);

  const wide = await sharp({ create: { width: 2000, height: 2000, channels: 3, background: '#123456' } }).jpeg().toBuffer();
  assert.equal((await app.upload('/admin/branding/share', wide, 'image/jpeg')).status, 303);
  const shareUrl = (await app.get('/?lang=en')).match(/og:image" content="https:\/\/shop.test(\/uploads\/[a-f0-9]{24}-share\.jpg)"/)?.[1];
  assert.ok(shareUrl);
  const share = await sharp(Buffer.from(await (await fetch(app.base + shareUrl)).arrayBuffer())).metadata();
  assert.deepEqual([share.width, share.height], [1200, 630]);

  await app.post('/admin/branding/logo/delete', {});
  await app.post('/admin/branding/share/delete', {});
  const after = await app.get('/?lang=en');
  assert.match(after, /brand-mark/);
  assert.match(after, /share-default.jpg/);
  assert.equal((await fetch(app.base + logoUrl)).status, 404, 'the old files are removed');
});
