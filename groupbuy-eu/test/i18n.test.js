import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LANGUAGE_CODES,
  flatten,
  fromAcceptLanguage,
  intlLocale,
  pickLanguage,
  translate,
  translateHtml,
  forLanguage,
} from '../src/i18n/index.js';
import { render } from '../src/emails.js';
import { tagSignature } from '../src/translate.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n', 'locales');
const read = (lang) => flatten(JSON.parse(fs.readFileSync(path.join(dir, `${lang}.json`), 'utf8')));
const en = read('en');
const placeholders = (s) => new Set(String(s).match(/\{\w+\}/g) ?? []);
const forms = (v) => (typeof v === 'string' ? { other: v } : v);

// The plural forms a language uses for whole numbers (what the shop shows: counts of buyers).
function neededForms(lang) {
  const rules = new Intl.PluralRules(intlLocale(lang));
  const out = new Set();
  for (let n = 0; n <= 200; n++) out.add(rules.select(n));
  return out;
}

for (const lang of LANGUAGE_CODES.filter((l) => l !== 'en')) {
  test(`dictionary ${lang}: same keys, placeholders, markup and plural forms as English`, () => {
    assert.ok(fs.existsSync(path.join(dir, `${lang}.json`)), `locales/${lang}.json is missing`);
    const dict = read(lang);
    assert.deepEqual(Object.keys(dict).sort(), Object.keys(en).sort(), 'keys differ from en.json');
    const needed = neededForms(lang);
    for (const [key, source] of Object.entries(en)) {
      const value = dict[key];
      const expected = placeholders(forms(source).other);
      if (typeof source === 'object') {
        assert.equal(typeof value, 'object', `${key}: needs plural forms`);
        for (const form of needed) assert.ok(typeof value[form] === 'string', `${key}: missing plural form "${form}"`);
      } else {
        assert.equal(typeof value, 'string', `${key}: should be a plain string`);
      }
      for (const [form, text] of Object.entries(forms(value))) {
        assert.ok(text.trim(), `${key}.${form}: empty`);
        const got = placeholders(text);
        // One/two/zero forms may spell the number out instead of using {count}.
        if (['one', 'two', 'zero'].includes(form)) got.add('{count}');
        if (!expected.has('{count}')) got.delete('{count}');
        assert.deepEqual([...got].sort(), [...expected].sort(), `${key}.${form}: placeholders differ`);
        if (key.endsWith('Html')) assert.equal(tagSignature(text), tagSignature(forms(source).other), `${key}.${form}: markup differs`);
      }
    }
  });
}

test('the visitor language comes from ?lang, then the cookie, then the browser', () => {
  assert.deepEqual(pickLanguage({ query: { lang: 'de' }, headers: { cookie: 'gb_lang=fr', 'accept-language': 'it' } }), { lang: 'de', chosen: true });
  assert.deepEqual(pickLanguage({ query: {}, headers: { cookie: 'a=1; gb_lang=fr', 'accept-language': 'it' } }), { lang: 'fr', chosen: false });
  assert.equal(pickLanguage({ query: { lang: 'xx' }, headers: { 'accept-language': 'pl-PL,pl;q=0.9,en;q=0.8' } }).lang, 'pl');
  assert.equal(fromAcceptLanguage('ja,zh;q=0.9'), null);
  assert.equal(fromAcceptLanguage('uk-UA,uk;q=0.9'), 'ru');
  assert.equal(fromAcceptLanguage('en;q=0.5,et;q=0.9'), 'et');
  assert.equal(pickLanguage({ query: {}, headers: {} }).lang, 'en');
});

test('plural forms, placeholders and escaping', () => {
  assert.equal(translate('en', 'card.moreNeeded', { count: 1 }), '1 more needed');
  assert.equal(translateHtml('en', 'home.statOpenHtml', { count: 2 }), '<strong>2</strong> open deals');
  assert.equal(translateHtml('en', 'done.failedHtml', { link: '"><script>', date: 'x' }).includes('<script>'), false);
  assert.equal(translate('en', 'no.such.key'), 'no.such.key');
  const pl = (n) => translate('pl', 'home.statOpenHtml', { count: n }).replace(String(n), 'N');
  assert.notEqual(pl(2), pl(5), 'Polish uses different forms for 2 and 5');
  assert.equal(pl(2), pl(3));
});

test('prices and dates follow the language', () => {
  assert.equal(forLanguage('en').formatEuro(4990), '€49.90');
  assert.match(forLanguage('de').formatEuro(4990), /^49,90\s€$/);
  assert.match(forLanguage('fr').formatDate('2026-12-24T12:00:00Z'), /déc/);
});

test('emails are written in the buyer\'s language and link to pages in it', () => {
  const deal = { product_name: 'Lamp', slug: 'lamp-1', status: 'open', min_buyers: 5, deadline: '2026-12-24T12:00:00Z', price_cents: 4990 };
  const business = { name: 'Shop', address: 'Street 1', email: 'shop@example.com' };
  const p = { name: 'Anna', token: 'tok', lang: 'de', amount_cents: 4990, tax_cents: 797 };
  const mail = render('joined', { deal, p, baseUrl: 'https://shop.test', business, now: new Date() });
  assert.match(mail.body, /^Hallo Anna,/);
  assert.match(mail.body, /https:\/\/shop\.test\/deals\/lamp-1\?lang=de/);
  assert.match(mail.body, /49,90/);
  const english = render('joined', { deal, p: { ...p, lang: undefined }, baseUrl: 'https://shop.test', business, now: new Date() });
  assert.match(english.body, /^Hi Anna,/);
});

test('withoutEmoji: drops decorative emoji, keeps text, symbols like © and HTML', async () => {
  const { withoutEmoji } = await import('../src/i18n/index.js');
  assert.equal(withoutEmoji('🎉 Ühisostud'), 'Ühisostud');
  assert.equal(withoutEmoji('Olen kambas 🙌'), 'Olen kambas');
  assert.equal(withoutEmoji('Liitu esimesena! 🥇'), 'Liitu esimesena!');
  assert.equal(withoutEmoji('<strong>2</strong> peaaegu täis 🔥'), '<strong>2</strong> peaaegu täis');
  assert.equal(withoutEmoji('👨‍👩‍👧 Семья ✅ готово'), 'Семья готово');
  assert.equal(withoutEmoji('© 2026 Shop™'), '© 2026 Shop™');
  assert.equal(withoutEmoji(undefined), '');
});
