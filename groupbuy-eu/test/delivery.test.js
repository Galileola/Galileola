import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDb, createRepo } from '../src/db.js';
import { createPhotoStore } from '../src/photos.js';
import { allRoutes } from '../src/routes/index.js';
import { parseDeliveryCountries } from '../src/deliveryCountries.js';
import { validateJoinInput } from '../src/routes/join.js';
import { buildSystemPrompt } from '../src/assistant.js';
import { createFakeStripe } from './support/fakeStripe.js';
import { adminLogin } from './support/admin.js';

// Admin → Settings → Delivery countries: the order form offers only the countries switched on.

async function startShop(dbFile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-delivery-'));
  const config = {
    port: 0, baseUrl: 'https://shop.test', adminUser: 'admin', adminPassword: 'secret-pw', appSecret: 'test-secret-0123456789abcdef',
    stripePublishableKey: 'pk_test_1', defaultTaxCode: 'txcd_99999999', uploadDir: path.join(dir, 'uploads'), trustProxy: false,
    quietEmails: true, contentLanguage: 'en', deliveryCountries: parseDeliveryCountries(''),
    business: { name: 'Test Shop', address: 'Street 1', email: 'shop@example.com', vatId: 'EE1', registration: 'R1', supervisoryAuthority: 'DPA', phone: '+372 5555 5555' },
  };
  const repo = createRepo(openDb(dbFile ?? path.join(dir, 'db.sqlite')));
  const ctx = { config, repo, clock: { now: () => new Date() }, stripe: createFakeStripe(), photos: createPhotoStore(config.uploadDir), routes: allRoutes, mailer: { send: async () => {} } };
  const server = createApp(ctx).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  if (!repo.dealBySlug('lamp-1')) repo.insertDeal({ slug: 'lamp-1', product_name: 'Oak lamp', description: '', image_url: '', price_cents: 4900, tax_code: 'txcd_99999999', min_buyers: 2, deadline: new Date(Date.now() + 2 * 86400000).toISOString(), created_at: new Date().toISOString() });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    server.closeAllConnections();
    server.close();
  };
  return { base, repo, close };
}

const options = (html) => [...html.matchAll(/<option value="([A-Z]{2})"\s*(selected)?\s*>/g)].map((m) => m[1] + (m[2] ? '*' : ''));

async function saveCountries(shop, headers, codes) {
  const page = await (await fetch(`${shop.base}/admin/delivery`, { headers })).text();
  const csrf = page.match(/name="_csrf" value="([^"]+)"/)[1];
  const body = new URLSearchParams([['_csrf', csrf], ...codes.map((c) => ['country', c])]);
  return fetch(`${shop.base}/admin/delivery`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual' });
}

test('delivery: DELIVERY_COUNTRIES is read as EU country codes, Estonia by default', () => {
  assert.deepEqual(parseDeliveryCountries(''), ['EE']);
  assert.deepEqual(parseDeliveryCountries(undefined), ['EE']);
  assert.deepEqual(parseDeliveryCountries('ee, lv;FI  xx US'), ['EE', 'LV', 'FI']);
});

test('delivery: only Estonia by default, switched on and off in the admin', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-delivery-db-'));
  const dbFile = path.join(dir, 'db.sqlite');
  const shop = await startShop(dbFile);
  t.after(shop.close);

  // One country: it is the only choice and already picked.
  assert.deepEqual(options(await (await fetch(`${shop.base}/deals/lamp-1?lang=en`)).text()), ['EE*']);
  assert.equal(validateJoinInput({ country: 'DE' }).errors.country, "We don't deliver to this country at the moment.");
  assert.equal(validateJoinInput({ country: 'EE' }).errors.country, undefined);
  // A posted form with another country is refused before anything else happens.
  const join = await fetch(`${shop.base}/deals/lamp-1/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ lang: 'en', email: 'a@b.ee', name: 'A', address_line1: 'Street 1', postal_code: '10111', city: 'Riga', country: 'LV', accept_terms: 'yes' }),
  });
  assert.equal(join.status, 422);
  assert.match(await join.text(), /We don&#39;t deliver to this country at the moment\.|We don't deliver to this country at the moment\./);
  assert.equal(shop.repo.participantsForDeal?.(shop.repo.dealBySlug('lamp-1').id)?.length ?? 0, 0);

  const headers = await adminLogin(shop.base);
  const page = await (await fetch(`${shop.base}/admin/delivery`, { headers })).text();
  assert.match(page, /value="EE" checked/);
  assert.match(page, /value="LV">/);
  assert.match(page, /Until you save this page/);
  assert.match(await (await fetch(`${shop.base}/admin/settings`, { headers })).text(), /href="\/admin\/delivery"/);

  // Nothing ticked is refused; Latvia switched on; unknown codes ignored.
  assert.equal((await saveCountries(shop, headers, [])).status, 422);
  assert.equal((await saveCountries(shop, headers, ['EE', 'LV', 'US', '<x>'])).status, 303);
  assert.deepEqual(options(await (await fetch(`${shop.base}/deals/lamp-1?lang=en`)).text()), ['EE', 'LV']);
  assert.equal(validateJoinInput({ country: 'LV' }).errors.country, undefined);

  // The choice is kept when the app restarts; Estonia switched off again leaves only Latvia.
  shop.close();
  const again = await startShop(dbFile);
  t.after(again.close);
  assert.deepEqual(options(await (await fetch(`${again.base}/deals/lamp-1?lang=en`)).text()), ['EE', 'LV']);
  assert.equal((await saveCountries(again, await adminLogin(again.base), ['LV'])).status, 303);
  assert.deepEqual(options(await (await fetch(`${again.base}/deals/lamp-1?lang=en`)).text()), ['LV*']);
});

test('delivery: the shopping assistant names the delivery countries, and test mode only when on', () => {
  const prompt = (extra) => buildSystemPrompt({ business: { name: 'Shop', email: 'a@b.ee' }, baseUrl: 'https://shop.test', deals: [], ...extra });
  const live = prompt({ deliveryTo: ['Estonia'], testMode: false });
  assert.match(live, /The shop delivers only to: Estonia\./);
  assert.doesNotMatch(live, /EU countries only|test mode/);
  assert.match(prompt({ deliveryTo: ['Estonia', 'Latvia'] }), /delivers only to: Estonia, Latvia\.[\s\S]*test mode/);
});

test('legal guarantee notice: the official EU notice on deal pages, Estonian for Estonian and Russian', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const notice = async (lang) => {
    const html = await (await fetch(`${shop.base}/deals/lamp-1?lang=${lang}`)).text();
    const m = html.match(/<section class="guarantee-notice" lang="(\w+)"[\s\S]*?<img src="([^"?]+)\?v=\w+"[^>]*alt="([^"]+)"[\s\S]*?class="visually-hidden">([^<]+)</);
    assert.ok(m, `${lang}: notice shown`);
    return { lang: m[1], src: m[2], alt: m[3], text: m[4] };
  };
  const et = await notice('et');
  assert.deepEqual([et.lang, et.src, et.alt], ['et', '/static/legal/eu-legal-guarantee-notice-et.jpg', 'Seadusest tulenev vastutus']);
  assert.match(et.text, /Vähemalt kaheaastane seadusest tulenev vastutus/);
  assert.equal((await notice('ru')).src, et.src, 'Russian is not an EU language: the Estonian notice');
  const en = await notice('en');
  assert.deepEqual([en.lang, en.src], ['en', '/static/legal/eu-legal-guarantee-notice-en.jpg']);
  assert.match(en.text, /Minimum two-year legal guarantee protection/);
  for (const src of [et.src, en.src]) {
    const img = await fetch(shop.base + src);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.ok((await img.arrayBuffer()).byteLength > 250_000, 'the full-size official image');
  }
});
