import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDb, createRepo } from '../src/db.js';
import { systemClock } from '../src/util.js';
import { publicRoutes } from '../src/routes/public.js';
import { legalRoutes } from '../src/routes/legal.js';
import { adminRoutes } from '../src/routes/admin.js';
import { createPhotoStore } from '../src/photos.js';
import { createTranslator } from '../src/translate.js';
import { ENGLISH_NAMES } from '../src/i18n/index.js';
import { adminLogin } from './support/admin.js';

const codeFor = Object.fromEntries(Object.entries(ENGLISH_NAMES).map(([code, name]) => [name, code]));

// Stand-in for Claude: "translates" by tagging every text with the language code. Deals come back
// as JSON (the request has a schema); pages come back as HTML with every tag kept.
function fakeClaude({ breakMarkup = false } = {}) {
  const calls = [];
  return {
    model: 'fake',
    calls,
    async reply({ system, messages, format }) {
      calls.push({ system, format });
      const lang = codeFor[/into (\w+)\./.exec(system)[1]];
      const input = messages[0].content;
      if (format) {
        const d = JSON.parse(input);
        return { text: JSON.stringify({ product_name: `[${lang}] ${d.product_name}`, headline: d.headline && `[${lang}] ${d.headline}`, description: `[${lang}] ${d.description}` }) };
      }
      const out = input.replace(/>([^<]+)</g, (m, text) => (text.trim() ? `>${lang.toUpperCase()}: ${text}<` : m));
      return { text: breakMarkup ? out.replace('</h1>', '</h1><script>alert(1)</script>') : out };
    },
  };
}

async function startApp(assistant) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-i18n-'));
  const config = {
    baseUrl: 'https://shop.test',
    adminUser: 'admin',
    adminPassword: 'secret-pw',
    appSecret: 'test-secret-0123456789abcdef',
    defaultTaxCode: 'txcd_99999999',
    uploadDir: path.join(dir, 'uploads'),
    trustProxy: false,
    business: { name: 'Test Shop', address: 'Street 1', email: 'shop@example.com', vatId: 'EE1', registration: 'R1', supervisoryAuthority: 'DPA', phone: '+372 5555 5555' },
  };
  const repo = createRepo(openDb(path.join(dir, 'db.sqlite')));
  const translator = createTranslator({ assistant, repo, clock: systemClock });
  const ctx = { config, repo, clock: systemClock, photos: createPhotoStore(config.uploadDir), assistant, translator, routes: [legalRoutes, publicRoutes, adminRoutes] };
  const server = createApp(ctx).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p, headers = {}) => {
    const r = await fetch(base + p, { headers });
    return { status: r.status, cookie: r.headers.get('set-cookie'), html: await r.text() };
  };
  const addDeal = () =>
    repo.insertDeal({
      slug: 'lamp-1', product_name: 'Desk lamp', description: 'Bright.\n\nFolds flat.', image_url: '', category: 'home',
      headline: 'Light that folds', social_post: '', price_cents: 4990, tax_code: 'txcd_99999999', min_buyers: 5,
      deadline: new Date(Date.now() + 5 * 864e5).toISOString(), created_at: new Date().toISOString(),
    });
  return { base, get, repo, translator, addDeal, close: () => server.close() };
}

test('the page language follows the browser, the menu choice and its cookie', async (t) => {
  const app = await startApp(null);
  t.after(app.close);

  const de = await app.get('/', { 'Accept-Language': 'de-AT,de;q=0.9' });
  assert.match(de.html, /<html lang="de">/);
  assert.match(de.html, /Gemeinsam kaufen\./);
  assert.equal(de.cookie, null, 'no cookie unless the visitor chooses a language');
  assert.equal((de.html.match(/rel="alternate" hreflang=/g) ?? []).length, 26);
  assert.equal((de.html.match(/<li><a href="\/\?lang=/g) ?? []).length, 25);

  const fr = await app.get('/?lang=fr', { 'Accept-Language': 'de' });
  assert.match(fr.html, /Achetez ensemble\./);
  assert.match(fr.cookie, /^gb_lang=fr; Max-Age=31536000; Path=\/; SameSite=Lax/);

  const remembered = await app.get('/', { Cookie: 'gb_lang=fr', 'Accept-Language': 'de' });
  assert.match(remembered.html, /<html lang="fr">/);

  const ru = await app.get('/?category=pets', { 'Accept-Language': 'ru' });
  assert.match(ru.html, /Домашние животные/);
  assert.match(ru.html, /href="\/\?category=pets&amp;lang=et"/, 'the menu keeps the current page');

  const admin = await app.get('/admin', { 'Accept-Language': 'de', ...(await adminLogin(app.base)) });
  assert.equal(admin.status, 200);
  assert.match(admin.html, /<html lang="en">/, 'the admin stays in English');
  assert.doesNotMatch(admin.html, /data-lang-menu/);
});

test('deals are translated in the background and the translation is kept', async (t) => {
  const claude = fakeClaude();
  const app = await startApp(claude);
  t.after(app.close);
  app.addDeal();

  const first = await app.get('/deals/lamp-1?lang=it');
  assert.match(first.html, /<h1>Desk lamp<\/h1>/, 'the first visitor sees the original text');
  await app.translator.idle();
  const second = await app.get('/deals/lamp-1?lang=it');
  assert.match(second.html, /<h1>\[it\] Desk lamp<\/h1>/);
  assert.match(second.html, /<p>\[it\] Bright\.<\/p>/);
  assert.match(second.html, /€|49,90/);

  const home = await app.get('/', { Cookie: 'gb_lang=it' });
  assert.match(home.html, /\[it\] Light that folds/);
  const callsBefore = claude.calls.length;
  await app.get('/deals/lamp-1?lang=it');
  await app.translator.idle();
  assert.equal(claude.calls.length, callsBefore, 'a kept translation is not requested again');

  const english = await app.get('/deals/lamp-1?lang=en');
  assert.match(english.html, /<h1>Desk lamp<\/h1>/);
  assert.equal(claude.calls.filter((c) => /into English/.test(c.system)).length, 0, 'deals are written in English: nothing to translate');
});

test('legal pages are translated with every tag kept, and the English text stays one click away', async (t) => {
  const app = await startApp(fakeClaude());
  t.after(app.close);

  const pending = await app.get('/terms?lang=nl');
  assert.match(pending.html, /Deze pagina wordt naar jouw taal vertaald/);
  assert.match(pending.html, /<h1>Terms and conditions<\/h1>/);
  await app.translator.idle();

  const done = await app.get('/terms?lang=nl');
  assert.match(done.html, /<h1>NL: Terms and conditions<\/h1>/);
  assert.match(done.html, /automatisch vertaald uit het Engels/);
  assert.match(done.html, /<a href="\?original=1" hreflang="en">Lees in het Engels<\/a>/);

  const original = await app.get('/terms?lang=nl&original=1');
  assert.match(original.html, /<h1>Terms and conditions<\/h1>/);
  assert.match(original.html, /<html lang="nl">/, 'the rest of the site keeps the visitor\'s language');
});

test('a translation that changes the page markup is thrown away', async (t) => {
  const app = await startApp(fakeClaude({ breakMarkup: true }));
  t.after(app.close);
  await app.get('/privacy?lang=es');
  await app.translator.idle();
  const page = await app.get('/privacy?lang=es');
  assert.doesNotMatch(page.html, /alert\(1\)/);
  assert.doesNotMatch(page.html, /ES: /);
});

test('without an API key the original texts are shown and nothing is pending', async (t) => {
  const app = await startApp(null);
  t.after(app.close);
  app.addDeal();
  const terms = await app.get('/terms?lang=pl');
  assert.doesNotMatch(terms.html, /Tłumaczymy tę stronę/);
  assert.match(terms.html, /<h1>Terms and conditions<\/h1>/);
  const deal = await app.get('/deals/lamp-1?lang=pl');
  assert.match(deal.html, /<h1>Desk lamp<\/h1>/);
  assert.match(deal.html, /49,90\s€/);
});
