import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, createRepo } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createPhotoStore } from '../src/photos.js';
import { validateDealInput } from '../src/deals.js';
import { validateSnapInput, parseSnapReply, SNAP_SCHEMA } from '../src/snap.js';
import { CATEGORY_SLUGS } from '../src/categories.js';
import { publicRoutes, withBadges } from '../src/routes/public.js';
import { adminRoutes } from '../src/routes/admin.js';
import { hmac, systemClock } from '../src/util.js';

// Smallest buffer that passes the type check (PNG signature + a few bytes).
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gb-test-'));
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

test('old databases get the category, headline and social_post columns', () => {
  const file = path.join(tmpDir(), 'old.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE deals (
    id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, product_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '',
    price_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'eur', tax_code TEXT NOT NULL,
    min_buyers INTEGER NOT NULL, deadline TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
    minimum_reached_at TEXT, grace_ends_at TEXT, ready_at TEXT, expired_at TEXT, created_at TEXT NOT NULL)`);
  old.prepare(`INSERT INTO deals (slug, product_name, price_cents, tax_code, min_buyers, deadline, created_at)
               VALUES ('mug-1', 'Mug', 900, 'txcd_99999999', 5, ?, ?)`).run(inDays(3), new Date().toISOString());
  old.close();

  const repo = createRepo(openDb(file));
  const deal = repo.dealBySlug('mug-1');
  assert.equal(deal.category, 'other');
  assert.equal(deal.headline, '');
  assert.equal(deal.social_post, '');
  // Opening again is a no-op.
  assert.doesNotThrow(() => openDb(file));
});

test('deal validation: category, headline, social post', () => {
  const base = { product_name: 'Lamp', price: '19.90', min_buyers: '5', deadline_iso: inDays(5) };
  const opts = { now: new Date(), defaultTaxCode: 'txcd_99999999' };
  assert.equal(validateDealInput(base, opts).deal.category, 'other');
  assert.equal(validateDealInput({ ...base, category: 'home', headline: '  Light  up\nyour desk ' }, opts).deal.headline, 'Light up your desk');
  assert.ok(validateDealInput({ ...base, category: 'spaceships' }, opts).errors.category);
  assert.ok(validateDealInput({ ...base, headline: 'x'.repeat(121) }, opts).errors.headline);
  assert.ok(validateDealInput({ ...base, social_post: 'x'.repeat(2001) }, opts).errors.social_post);
  // Phones send multipart line breaks as \r\n; paragraphs must still split on blank lines.
  assert.equal(validateDealInput({ ...base, description: 'One.\r\n\r\nTwo\r\n- a' }, opts).deal.description, 'One.\n\nTwo\n- a');
});

test('snap input and AI reply parsing', () => {
  assert.throws(() => validateSnapInput({ images: [] }), /Take a photo/);
  assert.throws(() => validateSnapInput({ images: [{ data: Buffer.from('not an image').toString('base64') }] }), /could not be read/);
  const ok = validateSnapInput({ notes: ' blue ', images: [{ data: PNG.toString('base64') }] });
  assert.equal(ok.notes, 'blue');
  assert.equal(ok.images[0].media_type, 'image/png');

  assert.deepEqual(SNAP_SCHEMA.properties.category.enum, CATEGORY_SLUGS);
  const reply = { product_name: 'Mug', headline: 'Hi', category: 'nope', description: 'Nice mug.', social_post: '#mug', photo_note: '' };
  assert.equal(parseSnapReply(JSON.stringify(reply)).category, 'other');
  assert.equal(parseSnapReply(JSON.stringify({ ...reply, category: 'home' })).category, 'home');
  assert.equal(parseSnapReply(JSON.stringify({ ...reply, description: '' })), null);
  assert.equal(parseSnapReply('not json'), null);
});

test('deal card badges', () => {
  const now = new Date();
  const d = { status: 'open', count: 1, min_buyers: 10, deadline: inDays(5), created_at: inDays(-10) };
  assert.equal(withBadges(d, now).badge, null);
  assert.equal(withBadges({ ...d, created_at: inDays(-1) }, now).badge, 'new');
  assert.equal(withBadges({ ...d, count: 8 }, now).badge, 'hot');
  assert.equal(withBadges({ ...d, count: 8, deadline: inDays(0.5) }, now).badge, 'ending');
  assert.equal(withBadges({ ...d, status: 'charging' }, now).badge, 'on');
});

// ---- HTTP: the snap flow, the category filter and the category picker
async function startApp(assistant) {
  const dir = tmpDir();
  const config = {
    baseUrl: 'https://shop.test',
    adminUser: 'admin',
    adminPassword: 'secret-pw',
    appSecret: 'test-secret-0123456789abcdef',
    defaultTaxCode: 'txcd_99999999',
    uploadDir: path.join(dir, 'uploads'),
    trustProxy: false,
    business: { name: 'Test Shop', address: 'Street 1', email: 'shop@example.com', vatId: 'EE1', registration: 'R1', supervisoryAuthority: 'DPA' },
  };
  const repo = createRepo(openDb(path.join(dir, 'db.sqlite')));
  const ctx = { config, repo, clock: systemClock, photos: createPhotoStore(config.uploadDir), assistant, routes: [publicRoutes, adminRoutes] };
  const server = createApp(ctx).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:secret-pw').toString('base64') };
  const csrf = hmac(config.appSecret, 'admin-csrf');
  return { base, auth, csrf, repo, config, close: () => server.close() };
}

test('snap: AI writes the ad, one tap publishes it with photos', async (t) => {
  const calls = [];
  const assistant = {
    async reply(args) {
      calls.push(args);
      return {
        text: JSON.stringify({
          product_name: 'Bamboo desk lamp',
          headline: 'Warm light, zero clutter 💡',
          category: 'home',
          description: 'A slim lamp.\n\nIt folds flat.',
          social_post: 'Look at this lamp! 💡\n#lamp #desk #home',
          photo_note: '',
        }),
      };
    },
  };
  const app = await startApp(assistant);
  t.after(app.close);

  const page = await fetch(`${app.base}/admin/snap`, { headers: app.auth });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /capture="environment"/);

  const ai = await fetch(`${app.base}/admin/ai/snap`, {
    method: 'POST',
    headers: { ...app.auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ _csrf: app.csrf, notes: '', images: [{ data: PNG.toString('base64') }] }),
  });
  assert.equal(ai.status, 200);
  const draft = await ai.json();
  assert.equal(draft.category, 'home');
  assert.equal(calls[0].format, SNAP_SCHEMA);
  assert.equal(calls[0].messages[0].content[0].type, 'image');
  assert.match(calls[0].system, /electronics: Electronics/);

  // Missing price: field errors come back as JSON.
  const form = (fields) => {
    const body = new FormData();
    body.append('_csrf', app.csrf);
    for (const [k, v] of Object.entries(fields)) body.append(k, v);
    body.append('photos', new Blob([PNG], { type: 'image/png' }), 'photo-1.jpg');
    return body;
  };
  const fields = { ...draft, price: '', min_buyers: '10', deadline_iso: inDays(7) };
  const bad = await fetch(`${app.base}/admin/snap`, { method: 'POST', headers: app.auth, body: form(fields) });
  assert.equal(bad.status, 422);
  assert.ok((await bad.json()).errors.price);

  const ok = await fetch(`${app.base}/admin/snap`, { method: 'POST', headers: app.auth, body: form({ ...fields, price: '24,90' }) });
  assert.equal(ok.status, 200);
  const { redirect } = await ok.json();
  const id = Number(redirect.match(/\/admin\/deals\/(\d+)\?live=1/)[1]);
  const deal = app.repo.dealById(id);
  assert.equal(deal.price_cents, 2490);
  assert.equal(deal.category, 'home');
  assert.equal(deal.headline, 'Warm light, zero clutter 💡');
  assert.match(deal.social_post, /#lamp/);
  assert.equal(app.repo.photosForDeal(id).length, 1);

  const admin = await (await fetch(`${app.base}${redirect}`, { headers: app.auth })).text();
  assert.match(admin, /Your deal is live/);
  assert.match(admin, /https:\/\/shop\.test\/deals\//);

  // Without a form token nothing is published.
  const noToken = new FormData();
  noToken.append('price', '5');
  const forged = await fetch(`${app.base}/admin/snap`, { method: 'POST', headers: app.auth, body: noToken });
  assert.equal(forged.status, 403);
});

test('snap: AI off gives a clear message', async (t) => {
  const app = await startApp(null);
  t.after(app.close);
  const r = await fetch(`${app.base}/admin/ai/snap`, {
    method: 'POST',
    headers: { ...app.auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ _csrf: app.csrf, images: [{ data: PNG.toString('base64') }] }),
  });
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /ANTHROPIC_API_KEY/);
});

test('home page filters by category; admin can change a category', async (t) => {
  const app = await startApp(null);
  t.after(app.close);
  const now = new Date().toISOString();
  const add = (slug, name, category) =>
    app.repo.insertDeal({ slug, product_name: name, description: '', image_url: '', category, headline: '', social_post: '',
      price_cents: 1000, tax_code: 'txcd_99999999', min_buyers: 5, deadline: inDays(5), created_at: now });
  add('phone-1', 'Phone stand', 'electronics');
  const mug = add('mug-1', 'Coffee mug', 'home');

  const all = await (await fetch(`${app.base}/`)).text();
  assert.match(all, /Phone stand/);
  assert.match(all, /Coffee mug/);
  assert.match(all, /Pets/); // every category has a chip

  const electronics = await (await fetch(`${app.base}/?category=electronics`)).text();
  assert.match(electronics, /Phone stand/);
  assert.doesNotMatch(electronics, /Coffee mug/);

  const pets = await (await fetch(`${app.base}/?category=pets`)).text();
  assert.match(pets, /No pets deals right now/);

  const unknown = await (await fetch(`${app.base}/?category=<script>`)).text();
  assert.match(unknown, /Coffee mug/);

  const dealPage = await (await fetch(`${app.base}/deals/mug-1`)).text();
  assert.match(dealPage, /Home &amp; Kitchen/);
  assert.match(dealPage, /wa\.me/);

  const r = await fetch(`${app.base}/admin/deals/${mug.id}/category`, {
    method: 'POST',
    headers: { ...app.auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: app.csrf, category: 'food' }),
    redirect: 'manual',
  });
  assert.equal(r.status, 303);
  assert.equal(app.repo.dealById(mug.id).category, 'food');
});
