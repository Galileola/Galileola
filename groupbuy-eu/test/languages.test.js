import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDb, createRepo } from '../src/db.js';
import { createPhotoStore } from '../src/photos.js';
import { allRoutes } from '../src/routes/index.js';
import { LANGUAGES, pickLanguage, shopLanguages } from '../src/i18n/index.js';
import { goLiveChecks } from '../src/goLive.js';
import { createFakeStripe } from './support/fakeStripe.js';
import { adminLogin } from './support/admin.js';

// Admin → Settings → Languages: the shop offers only the languages the owner ticks.

async function startShop(dbFile, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-langs-'));
  const config = {
    port: 0, baseUrl: 'https://shop.test', adminUser: 'admin', adminPassword: 'secret-pw', appSecret: 'test-secret-0123456789abcdef',
    stripePublishableKey: 'pk_test_1', defaultTaxCode: 'txcd_99999999', uploadDir: path.join(dir, 'uploads'), trustProxy: false,
    quietEmails: true, contentLanguage: 'en',
    business: { name: 'Test Shop', address: 'Street 1', email: 'shop@example.com', vatId: 'EE1', registration: 'R1', supervisoryAuthority: 'DPA', phone: '+372 5555 5555' },
    ...extra,
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
  return { base, repo, config, close };
}

const menu = (html) => [...html.matchAll(/<li><a href="[^"]*\?lang=(\w+)" hreflang=/g)].map((m) => m[1]);

async function saveLanguages(shop, codes) {
  const headers = await adminLogin(shop.base);
  const page = await (await fetch(`${shop.base}/admin/languages`, { headers })).text();
  const csrf = page.match(/name="_csrf" value="([^"]+)"/)[1];
  const body = new URLSearchParams([['_csrf', csrf], ...codes.map((c) => ['lang', c])]);
  const res = await fetch(`${shop.base}/admin/languages`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual' });
  assert.equal(res.status, 303);
  return headers;
}

test('languages: every language until the owner chooses', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  assert.equal(menu(await (await fetch(`${shop.base}/?lang=en`)).text()).length, LANGUAGES.length);
  const headers = await adminLogin(shop.base);
  const page = await (await fetch(`${shop.base}/admin/languages`, { headers })).text();
  assert.match(page, /Until you save this page, the shop offers every language/);
  assert.equal((page.match(/name="lang" value="\w+" checked/g) ?? []).length, LANGUAGES.length);
});

test('languages: the shop offers only the ticked languages, plus English', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-langs-db-'));
  const dbFile = path.join(dir, 'db.sqlite');
  const shop = await startShop(dbFile);
  t.after(shop.close);
  // English isn't ticked here (its box is locked on in the form); "xx" and markup are ignored.
  await saveLanguages(shop, ['et', 'ru', 'lv', 'fi', 'xx', '<script>']);
  assert.deepEqual(shopLanguages().map((l) => l.code), ['en', 'et', 'fi', 'lv', 'ru']);

  const home = await (await fetch(`${shop.base}/?lang=et`)).text();
  assert.deepEqual(menu(home), ['en', 'et', 'fi', 'lv', 'ru']);
  assert.match(home, /<html lang="et"/);
  assert.equal((home.match(/rel="alternate" hreflang="(?!x-default)/g) ?? []).length, 5, 'search engines see 5 languages');

  // A language that isn't offered: not by link, not by cookie, not from the browser.
  const de = await fetch(`${shop.base}/?lang=de`);
  assert.match(await de.text(), /<html lang="en"/);
  assert.ok(!de.headers.getSetCookie().some((c) => c.startsWith('gb_lang=de')));
  assert.match(await (await fetch(`${shop.base}/`, { headers: { Cookie: 'gb_lang=de' } })).text(), /<html lang="en"/);
  assert.match(await (await fetch(`${shop.base}/`, { headers: { 'Accept-Language': 'de-DE,de;q=0.9' } })).text(), /<html lang="en"/);
  assert.match(await (await fetch(`${shop.base}/`, { headers: { 'Accept-Language': 'lv-LV,lv;q=0.9,en;q=0.5' } })).text(), /<html lang="lv"/);
  // Ukrainian and Belarusian browsers still get Russian.
  assert.match(await (await fetch(`${shop.base}/`, { headers: { 'Accept-Language': 'uk-UA' } })).text(), /<html lang="ru"/);
  assert.equal(pickLanguage({ query: { lang: 'sv' }, headers: { 'accept-language': 'fi' } }).lang, 'fi');

  const sitemap = await (await fetch(`${shop.base}/sitemap.xml`)).text();
  const locs = [...sitemap.matchAll(/<loc>[^<]*\?lang=(\w+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(locs)].sort(), ['en', 'et', 'fi', 'lv', 'ru']);

  // The choice is kept when the app restarts.
  shop.close();
  const again = await startShop(dbFile);
  t.after(again.close);
  assert.deepEqual(menu(await (await fetch(`${again.base}/?lang=en`)).text()), ['en', 'et', 'fi', 'lv', 'ru']);
  const headers = await adminLogin(again.base);
  const page = await (await fetch(`${again.base}/admin/languages`, { headers })).text();
  assert.match(page, /value="en" checked disabled/);
  assert.match(page, /value="de">/);
  // Admin pages for the other settings list only these languages too.
  const legal = await (await fetch(`${again.base}/admin/legal`, { headers })).text();
  assert.match(legal, /\/admin\/legal\/terms\/lv/);
  assert.doesNotMatch(legal, /\/admin\/legal\/terms\/de/);
});

test('languages: category names for languages switched off are kept', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const headers = await adminLogin(shop.base);
  const saveCategory = async (fields) => {
    const page = await (await fetch(`${shop.base}/admin/categories/pets`, { headers })).text();
    const csrf = page.match(/name="_csrf" value="([^"]+)"/)[1];
    const res = await fetch(`${shop.base}/admin/categories/pets`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, emoji: '🐾', ...fields }), redirect: 'manual',
    });
    assert.equal(res.status, 303);
    return page;
  };
  const names = () => {
    const pets = shop.repo.listCategories().find((c) => c.slug === 'pets');
    return typeof pets.names === 'string' ? JSON.parse(pets.names) : pets.names;
  };
  // While every language is on, the owner names the category in German and Estonian.
  await saveCategory({ name_de: 'Haustiere', name_et: 'Lemmikud' });
  assert.equal(names().de, 'Haustiere');
  // Then German is switched off, and the Estonian name is changed.
  await saveLanguages(shop, ['et']);
  const page = await saveCategory({ name_et: 'Lemmikloomad' });
  assert.match(page, /name="name_et"/);
  assert.doesNotMatch(page, /name="name_de"/);
  assert.equal(names().et, 'Lemmikloomad');
  assert.equal(names().de, 'Haustiere', 'the German name is still there for when German is switched on again');
});

test('languages: an Estonian-only shop (Estonian main language, English switched off)', async (t) => {
  const shop = await startShop(undefined, { contentLanguage: 'et' });
  t.after(shop.close);
  const headers = await adminLogin(shop.base);
  const before = await (await fetch(`${shop.base}/admin/languages`, { headers })).text();
  assert.match(before, /value="et" checked disabled/, 'the main language is always on');
  assert.match(before, /data-lang-set="et">Only Estonian</);
  await saveLanguages(shop, ['et']);
  assert.deepEqual(shopLanguages().map((l) => l.code), ['et']);
  const after = await (await fetch(`${shop.base}/admin/languages`, { headers })).text();
  assert.match(after, /value="en">/, 'English is off and can be switched on again');

  // Every visitor gets Estonian: no choice, an English browser, a link to English.
  for (const opts of [{}, { headers: { 'Accept-Language': 'en-GB,en;q=0.9' } }]) {
    assert.match(await (await fetch(`${shop.base}/`, opts)).text(), /<html lang="et"/);
  }
  const en = await fetch(`${shop.base}/?lang=en`);
  const home = await en.text();
  assert.match(home, /<html lang="et"/);
  assert.ok(!en.headers.getSetCookie().some((c) => c.startsWith('gb_lang=en')));
  assert.doesNotMatch(home, /data-lang-menu/, 'no language menu with one language');
  assert.deepEqual([...home.matchAll(/hreflang="([\w-]+)" href="[^"]*\?lang=(\w+)"/g)].map((m) => `${m[1]}=${m[2]}`), ['et=et', 'x-default=et']);
  const sitemap = await (await fetch(`${shop.base}/sitemap.xml`)).text();
  assert.deepEqual([...new Set([...sitemap.matchAll(/\?lang=(\w+)/g)].map((m) => m[1]))], ['et']);

  // Going live needs the Estonian legal pages complete, not the English ones.
  const terms = () => goLiveChecks({ config: shop.config, repo: shop.repo }).find((c) => c.label === 'Terms & withdrawal right');
  assert.equal(terms().ok, false);
  assert.match(terms().detail, /\(Estonian\)/);
  assert.equal(terms().href, '/admin/legal/terms/et');
  shop.repo.saveLegalText('terms', 'et', '# Tingimused\n\nTarnime 5 päeva jooksul Eestisse.', new Date().toISOString());
  assert.equal(terms().ok, true);
  assert.equal(terms().detail, 'Your own text.');
});
