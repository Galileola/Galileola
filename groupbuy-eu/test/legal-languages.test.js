import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { openDb, createRepo } from '../src/db.js';
import { createPhotoStore } from '../src/photos.js';
import { allRoutes } from '../src/routes/index.js';
import { goLiveChecks } from '../src/goLive.js';
import { createFakeStripe } from './support/fakeStripe.js';
import { adminLogin } from './support/admin.js';

// The legal pages and the cookie notice in the visitor's language (Estonian and Russian have
// built-in translations of the built-in English pages, all following Estonian law).

const views = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'views', 'legal');
const TRANSLATED = ['et', 'ru'];
const PAGES = ['terms', 'privacy', 'cookies'];

async function startShop(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-legal-langs-'));
  const config = {
    port: 0, baseUrl: 'https://shop.test', adminUser: 'admin', adminPassword: 'secret-pw', appSecret: 'test-secret-0123456789abcdef',
    stripePublishableKey: 'pk_test_1', defaultTaxCode: 'txcd_99999999', uploadDir: path.join(dir, 'uploads'), trustProxy: false,
    quietEmails: true, contentLanguage: 'en', paymentsMode: 'test',
    business: { name: 'Põhjala Ost OÜ', address: 'Narva mnt 5, 10117 Tallinn, Estonia', email: 'shop@example.com', vatId: 'EE100000000', registration: 'Reg. 12345678', supervisoryAuthority: 'Andmekaitse Inspektsioon', phone: '+372 5555 5555' },
    ...extra,
  };
  const repo = createRepo(openDb(path.join(dir, 'db.sqlite')));
  const ctx = { config, repo, clock: { now: () => new Date() }, stripe: createFakeStripe(), photos: createPhotoStore(config.uploadDir), routes: allRoutes, mailer: { send: async () => {} } };
  const server = createApp(ctx).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p, headers = {}) => (await fetch(base + p, { headers })).text();
  return { base, repo, ctx, get, close: () => { server.closeAllConnections(); server.close(); } };
}

const article = (html) => html.match(/<article class="legal" lang="(\w+)">([\s\S]*?)<\/article>/);

test('legal pages: Estonian and Russian visitors read them in their language', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const headings = {
    et: ['Müügitingimused', 'Privaatsuspoliitika', 'Küpsised'],
    ru: ['Условия продажи', 'Политика конфиденциальности', 'Cookies'],
  };
  for (const lang of TRANSLATED) {
    for (const [i, page] of PAGES.entries()) {
      const html = await shop.get(`/${page}?lang=${lang}`);
      assert.match(html, new RegExp(`<html lang="${lang}"`), `${page} ${lang}: page language`);
      const [, contentLang, body] = article(html);
      assert.equal(contentLang, lang, `${page} ${lang}: the text is marked as ${lang}`);
      assert.match(body, new RegExp(`<h1>${headings[lang][i]}</h1>`), `${page} ${lang}: heading`);
      assert.doesNotMatch(body, /only available in English|Template: have/, `${page} ${lang}: no English left`);
      if (page !== 'cookies') assert.match(body, /Põhjala Ost OÜ/, `${page} ${lang}: company details filled in`);
    }
    // The withdrawal section and the model form are there, with the link anchors.
    const terms = await shop.get(`/terms?lang=${lang}`);
    assert.match(terms, /id="withdrawal"/);
    assert.match(terms, /id="payment"/);
    assert.match(terms, /Narva mnt 5, 10117 Tallinn, Estonia, \+372 5555 5555, shop@example\.com/);
    // The online withdrawal function (Estonian model instructions, note 3) and the delivery countries.
    assert.match(terms, /<a href="https:\/\/shop\.test\/withdraw">https:\/\/shop\.test\/withdraw<\/a>/);
    assert.match(terms, /Tarnime järgmistesse riikidesse: [^.<]*Eesti|Мы доставляем в следующие страны: [^.<]*Эстония/);
  }
  // A language without a translation (Finnish too) still says that the page is in English.
  assert.match(await shop.get('/terms?lang=fi'), /<article class="legal" lang="en">\s*<p class="notice small" lang="fi">/);
  assert.match(await shop.get('/terms?lang=de'), /<article class="legal" lang="en">\s*<p class="notice small" lang="de">/);
  // ?original=1 shows the English text.
  assert.match(await shop.get('/terms?lang=et&original=1'), /<h1>Terms and conditions<\/h1>/);
});

test('legal pages: each translation has the same structure as the English page', () => {
  const shape = (file) => {
    const s = fs.readFileSync(path.join(views, file), 'utf8').replace(/<%#[\s\S]*?%>/g, '');
    return {
      tags: [...s.matchAll(/<(h1|h2|h3|p|ul|li|table|tr|th|td|div|code|strong|a|button|br)\b/g)].map((m) => m[1]).join(' '),
      ejs: [...s.matchAll(/<%[-=]?\s*([\s\S]*?)\s*%>/g)].map((m) => m[1]).join(' | '),
      ids: [...s.matchAll(/id="([^"]+)"/g)].map((m) => m[1]).join(' '),
    };
  };
  for (const page of PAGES) {
    const en = shape(`${page}-body.ejs`);
    for (const lang of TRANSLATED) {
      const tr = shape(`${page}-body.${lang}.ejs`);
      assert.equal(tr.tags, en.tags, `${page}-body.${lang}.ejs: tags differ from the English page`);
      assert.equal(tr.ejs, en.ejs, `${page}-body.${lang}.ejs: template code differs from the English page`);
      assert.equal(tr.ids, en.ids, `${page}-body.${lang}.ejs: anchors differ`);
    }
  }
});

test('legal pages: the owner\'s own texts win over the built-in translations', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const auth = await adminLogin(shop.base);
  // The editor starts from the built-in translation.
  const editor = await shop.get('/admin/legal/terms/et', auth);
  assert.match(editor, /<textarea[^>]*>[\s\S]*Müügitingimused[\s\S]*<\/textarea>/);
  assert.match(editor, /built-in Estonian translation/);
  assert.match(await shop.get('/admin/legal', auth), /Built-in translation/);

  // Own Estonian text: shown instead of the built-in one.
  shop.repo.saveLegalText('terms', 'et', '# Meie tingimused\n\nOma tekst.', new Date().toISOString());
  assert.match(article(await shop.get('/terms?lang=et'))[2], /<h1>Meie tingimused<\/h1>/);

  // Own English text: the built-in translations (of the built-in English) stop showing.
  shop.repo.saveLegalText('privacy', 'en', '# Our privacy policy\n\nOur own text.', new Date().toISOString());
  const ru = await shop.get('/privacy?lang=ru');
  assert.equal(article(ru)[1], 'en');
  assert.match(article(ru)[2], /<h1>Our privacy policy<\/h1>/);
  assert.match(ru, /<p class="notice small" lang="ru">/, 'says, in Russian, that the page is in English');
});

test('go-live: an own text in another shop language with [brackets] left is not finished', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const now = new Date().toISOString();
  for (const page of PAGES) shop.repo.saveLegalText(page, 'en', `# ${page}\n\nComplete text.`, now);
  const check = () => goLiveChecks(shop.ctx).find((c) => c.label === 'Terms & withdrawal right');
  assert.equal(check().ok, true);
  shop.repo.saveLegalText('terms', 'lv', '# Noteikumi\n\n[Piegādes laiks.]', now);
  assert.equal(check().ok, false);
  assert.match(check().detail, /\(Latvian\)/);
  assert.equal(check().href, '/admin/legal/terms/lv');
});

test('cookie notice: one "OK" while there are no optional cookies; "Accept all" once there are', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const ok = { en: 'OK', et: 'Selge', fi: 'Selvä', lv: 'Labi', ru: 'Понятно' };
  for (const [lang, word] of Object.entries(ok)) {
    const banner = (await shop.get(`/?lang=${lang}`)).match(/<div class="cookie-banner"[\s\S]*?<\/div>\s*<\/div>/)[0];
    assert.equal((banner.match(/data-consent=/g) ?? []).length, 1, `${lang}: one button`);
    assert.match(banner, new RegExp(`data-consent="necessary">${word}</button>`));
    assert.doesNotMatch(banner, /data-consent="all"|Accept optional/);
  }
  const withAnalytics = await startShop({ optionalCookies: ['_example_analytics'] });
  t.after(withAnalytics.close);
  const banner = (await withAnalytics.get('/?lang=en')).match(/<div class="cookie-banner"[\s\S]*?<\/div>\s*<\/div>/)[0];
  assert.match(banner, /data-consent="necessary">Only necessary<\/button>/);
  assert.match(banner, /data-consent="all">Accept all<\/button>/);
});
