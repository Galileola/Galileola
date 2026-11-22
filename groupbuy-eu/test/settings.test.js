import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDb, createRepo } from '../src/db.js';
import { systemClock, hmac } from '../src/util.js';
import { publicRoutes } from '../src/routes/public.js';
import { legalRoutes } from '../src/routes/legal.js';
import { adminRoutes } from '../src/routes/admin.js';
import { createPhotoStore } from '../src/photos.js';
import { allCategories, categoryFor } from '../src/categories.js';
import { snapSchema } from '../src/snap.js';
import { adminLogin } from './support/admin.js';

async function startApp({ assistant = null, dbFile } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-settings-'));
  const config = {
    baseUrl: 'https://shop.test', adminUser: 'admin', adminPassword: 'secret-pw', appSecret: 'test-secret-0123456789abcdef',
    defaultTaxCode: 'txcd_99999999', uploadDir: path.join(dir, 'uploads'), trustProxy: false,
    business: { name: '[Your company name]', address: '[Street, postcode, city, country]', email: 'env@example.com', vatId: '[EU VAT number]', registration: '[Company register and number]', supervisoryAuthority: '[DPA]' },
  };
  const repo = createRepo(openDb(dbFile ?? path.join(dir, 'db.sqlite')));
  const ctx = { config, repo, clock: systemClock, photos: createPhotoStore(config.uploadDir), assistant, routes: [legalRoutes, publicRoutes, adminRoutes] };
  const server = createApp(ctx).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = await adminLogin(base);
  const csrf = hmac(config.appSecret, 'admin-csrf');
  const get = async (p, headers = {}) => (await fetch(base + p, { headers })).text();
  const post = (p, fields) =>
    fetch(base + p, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, ...fields }),
      redirect: 'manual',
    });
  return { base, auth, csrf, repo, config, get, post, dir, close: () => server.close() };
}

test('shop details saved in the admin appear in the footer and legal pages, and survive a restart', async (t) => {
  const app = await startApp();
  t.after(app.close);
  assert.match(await app.get('/admin/settings', app.auth), /Shop details[\s\S]*Categories[\s\S]*Legal pages[\s\S]*Password/);

  const bad = await app.post('/admin/business', { name: 'SEK Digital OÜ', email: 'not-an-email' });
  assert.equal(bad.status, 422);

  const r = await app.post('/admin/business', {
    name: 'SEK Digital OÜ', address: 'Narva mnt 5, 10117 Tallinn, Estonia', email: 'hello@sekdigital.eu',
    vatId: 'EE102345678', registration: 'Registry code 16123456', supervisoryAuthority: 'Andmekaitse Inspektsioon',
  });
  assert.equal(r.status, 303);
  const home = await app.get('/');
  assert.match(home, /SEK Digital OÜ · Narva mnt 5, 10117 Tallinn, Estonia · VAT EE102345678/);
  const terms = await app.get('/terms');
  assert.match(terms, /SEK Digital OÜ, Narva mnt 5, 10117 Tallinn, Estonia\. Email: hello@sekdigital\.eu\. VAT number: EE102345678\. Registry code 16123456\./);
  assert.match(await app.get('/privacy'), /Andmekaitse Inspektsioon/);
  assert.match(await app.get('/admin/business', app.auth), /value="EE102345678"/);

  // An empty field falls back to the hosting setting (here env@example.com).
  await app.post('/admin/business', { name: 'SEK Digital OÜ' });
  assert.match(await app.get('/terms'), /Email: env@example\.com/);

  app.close();
  const again = await startApp({ dbFile: path.join(app.dir, 'db.sqlite') });
  t.after(again.close);
  assert.match(await again.get('/'), /SEK Digital OÜ/, 'saved details are read back after a restart');
});

test('categories: add, name per language, rename, reorder and remove', async (t) => {
  const app = await startApp();
  t.after(app.close);
  assert.equal(allCategories().length, 12, 'the built-in list is the starting point');
  const deal = app.repo.insertDeal({
    slug: 'case-1', product_name: 'Phone case', description: '', image_url: '', category: 'electronics', headline: '', social_post: '',
    price_cents: 1500, tax_code: 'txcd_99999999', min_buyers: 3, deadline: new Date(Date.now() + 3 * 864e5).toISOString(), created_at: new Date().toISOString(),
  });

  // Add
  const added = await app.post('/admin/categories', { emoji: '📲', name: 'Phone cases', hint: 'cases and covers for phones' });
  assert.equal(added.status, 303);
  assert.equal(added.headers.get('location'), '/admin/categories/phone-cases?added=1');
  assert.equal(allCategories().at(-1).slug, 'phone-cases');
  assert.ok(snapSchema().properties.category.enum.includes('phone-cases'), '"Snap a deal" can pick it');
  assert.match(await app.get('/?lang=de'), /📲<\/span>Phone cases/, 'without a German name the English one is shown');

  // Names per language, and the deal moves into it
  await app.post('/admin/categories/phone-cases', { emoji: '📲', hint: 'cases', name_en: 'Phone cases', name_de: 'Handyhüllen' });
  assert.match(await app.get('/?lang=de'), /Handyhüllen/);
  assert.equal((await app.post(`/admin/deals/${deal.id}/category`, { category: 'phone-cases' })).status, 303);
  assert.match(await app.get('/deals/case-1?lang=de'), /Handyhüllen/);

  // Rename a built-in category in English only: German keeps its built-in translation
  await app.post('/admin/categories/pets', { emoji: '🐶', name_en: 'Animals' });
  assert.match(await app.get('/?lang=en'), /🐶<\/span>Animals/);
  assert.match(await app.get('/?lang=de'), /🐶<\/span>Haustiere/);

  // Reorder
  const before = allCategories().map((c) => c.slug);
  await app.post('/admin/categories/phone-cases/move', { dir: 'up' });
  const after = allCategories().map((c) => c.slug);
  assert.equal(after.indexOf('phone-cases'), before.indexOf('phone-cases') - 1);

  // Remove: its deal moves to "Other"; "Other" itself can't be removed
  const removed = await app.post('/admin/categories/phone-cases/delete', {});
  assert.equal(removed.status, 303);
  assert.equal(app.repo.dealById(deal.id).category, 'other');
  assert.equal(categoryFor('phone-cases').slug, 'other');
  assert.doesNotMatch(await app.get('/'), /Phone cases/);
  assert.equal((await app.post('/admin/categories/other/delete', {})).status, 422);
  assert.match(await app.get(removed.headers.get('location'), app.auth), /Removed &#34;Phone cases&#34;\. Its deals are now in &#34;Other&#34;\./);

  // Bad input
  assert.equal((await app.post('/admin/categories', { emoji: '<b>', name: 'X' })).status, 422);
  assert.equal((await app.post('/admin/categories', { emoji: '🎁', name: '' })).status, 422);
});

test('category names for every language can be filled in by AI', async (t) => {
  const assistant = {
    model: 'fake',
    async reply({ format }) {
      return { text: JSON.stringify(Object.fromEntries(Object.keys(format.properties).map((code) => [code, `${code}-name`]))) };
    },
  };
  const app = await startApp({ assistant });
  t.after(app.close);
  const r = await fetch(`${app.base}/admin/categories/pets/ai-names`, {
    method: 'POST', headers: { ...app.auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ _csrf: app.csrf, name: 'Pets' }),
  });
  assert.equal(r.status, 200);
  const { names } = await r.json();
  assert.equal(Object.keys(names).length, 24);
  assert.equal(names.de, 'de-name');
  assert.equal(names.en, undefined);

  const noAi = await startApp();
  t.after(noAi.close);
  const r2 = await fetch(`${noAi.base}/admin/categories/pets/ai-names`, {
    method: 'POST', headers: { ...noAi.auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ _csrf: noAi.csrf }),
  });
  assert.equal(r2.status, 503);
});
