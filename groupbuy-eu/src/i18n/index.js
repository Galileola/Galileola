import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EU_COUNTRIES } from '../util.js';

// The shop's languages: the 24 official EU languages plus Russian. Each has a dictionary in
// locales/<code>.json with the same keys as en.json. A key that is missing in a language falls
// back to English, so a half-finished dictionary never breaks a page.
export const LANGUAGES = [
  { code: 'bg', name: 'Български' },
  { code: 'cs', name: 'Čeština' },
  { code: 'da', name: 'Dansk' },
  { code: 'de', name: 'Deutsch' },
  { code: 'el', name: 'Ελληνικά' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'et', name: 'Eesti' },
  { code: 'fi', name: 'Suomi' },
  { code: 'fr', name: 'Français' },
  { code: 'ga', name: 'Gaeilge' },
  { code: 'hr', name: 'Hrvatski' },
  { code: 'hu', name: 'Magyar' },
  { code: 'it', name: 'Italiano' },
  { code: 'lt', name: 'Lietuvių' },
  { code: 'lv', name: 'Latviešu' },
  { code: 'mt', name: 'Malti' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' },
  { code: 'pt', name: 'Português' },
  { code: 'ro', name: 'Română' },
  { code: 'ru', name: 'Русский' },
  { code: 'sk', name: 'Slovenčina' },
  { code: 'sl', name: 'Slovenščina' },
  { code: 'sv', name: 'Svenska' },
];
export const DEFAULT_LANGUAGE = 'en';
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);
// English names, for prompts to the translation model.
export const ENGLISH_NAMES = {
  bg: 'Bulgarian', cs: 'Czech', da: 'Danish', de: 'German', el: 'Greek', en: 'English', es: 'Spanish',
  et: 'Estonian', fi: 'Finnish', fr: 'French', ga: 'Irish', hr: 'Croatian', hu: 'Hungarian', it: 'Italian',
  lt: 'Lithuanian', lv: 'Latvian', mt: 'Maltese', nl: 'Dutch', pl: 'Polish', pt: 'Portuguese', ro: 'Romanian',
  ru: 'Russian', sk: 'Slovak', sl: 'Slovenian', sv: 'Swedish',
};
export const LANGUAGE_COOKIE = 'gb_lang';

const known = new Set(LANGUAGE_CODES);
// A language the code has a dictionary for (whether or not the shop offers it).
export const isLanguage = (code) => typeof code === 'string' && known.has(code);

// The languages the shop offers to visitors (Admin → Settings → Languages, src/shopLanguages.js):
// the language menu, the language picked from the browser, search engines' links and the deal
// translations. Every dictionary stays in the code, so a language switched off can come back at
// any time; buyers who joined in it keep getting their emails in it.
let offered = new Set(LANGUAGE_CODES);
let main = DEFAULT_LANGUAGE;
// required[0] is the shop's main language: always offered, and the one visitors get when they
// haven't chosen a language and their browser's isn't offered.
export function setShopLanguages(codes, required = [DEFAULT_LANGUAGE]) {
  offered = new Set([...(codes ?? []), ...required].filter(isLanguage));
  main = required.find(isLanguage) ?? DEFAULT_LANGUAGE;
}
export const mainLanguage = () => main;
export const shopLanguages = () => LANGUAGES.filter((l) => offered.has(l.code));
export const isShopLanguage = (code) => isLanguage(code) && offered.has(code);

// Locale used for numbers and dates. en-IE writes euro amounts the European way (€49.00).
const INTL_LOCALE = { en: 'en-IE', pt: 'pt-PT' };
export const intlLocale = (lang) => INTL_LOCALE[lang] ?? lang;

// Facebook's og:locale names (language_COUNTRY) for the link previews.
const OG_LOCALE = {
  bg: 'bg_BG', cs: 'cs_CZ', da: 'da_DK', de: 'de_DE', el: 'el_GR', en: 'en_GB', es: 'es_ES', et: 'et_EE', fi: 'fi_FI',
  fr: 'fr_FR', ga: 'ga_IE', hr: 'hr_HR', hu: 'hu_HU', it: 'it_IT', lt: 'lt_LT', lv: 'lv_LV', mt: 'mt_MT', nl: 'nl_NL',
  pl: 'pl_PL', pt: 'pt_PT', ro: 'ro_RO', ru: 'ru_RU', sk: 'sk_SK', sl: 'sl_SI', sv: 'sv_SE',
};
export const ogLocale = (lang) => OG_LOCALE[lang] ?? 'en_GB';

// Stripe's payment form speaks all of these except Irish, which gets English.
export const stripeLocale = (lang) => (lang === 'ga' ? 'en' : lang);

// ---- dictionaries

const PLURAL_KEYS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const isPluralEntry = (v) =>
  v && typeof v === 'object' && !Array.isArray(v) && 'other' in v && Object.keys(v).every((k) => PLURAL_KEYS.has(k));

// { home: { title: 'Deals' } } -> { 'home.title': 'Deals' }. Plural entries stay objects.
export function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string' || isPluralEntry(v)) out[key] = v;
    else if (v && typeof v === 'object') flatten(v, key, out);
  }
  return out;
}

const localesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'locales');
const dictionaries = new Map();
export function dictionary(lang) {
  if (!dictionaries.has(lang)) {
    let dict = {};
    try {
      dict = flatten(JSON.parse(fs.readFileSync(path.join(localesDir, `${lang}.json`), 'utf8')));
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`[i18n] could not read locales/${lang}.json: ${err.message}`);
    }
    dictionaries.set(lang, dict);
  }
  return dictionaries.get(lang);
}

const pluralRules = new Map();
function pluralCategory(lang, n) {
  if (!pluralRules.has(lang)) {
    let rules;
    try {
      rules = new Intl.PluralRules(intlLocale(lang));
    } catch {
      rules = new Intl.PluralRules('en');
    }
    pluralRules.set(lang, rules);
  }
  return pluralRules.get(lang).select(Number(n) || 0);
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function lookup(lang, key, vars) {
  let entry = dictionary(lang)[key];
  if (entry === undefined && lang !== DEFAULT_LANGUAGE) entry = dictionary(DEFAULT_LANGUAGE)[key];
  if (entry === undefined) return key;
  if (typeof entry === 'object') entry = entry[pluralCategory(lang, vars?.count)] ?? entry.other;
  return entry;
}

const fill = (text, values) =>
  text.replace(/\{(\w+)\}/g, (m, name) => (values && Object.hasOwn(values, name) ? String(values[name]) : m));

// t('home.title') -> plain text (EJS escapes it with <%= %>). {name} placeholders are filled
// from vars; vars.count also picks the plural form.
export function translate(lang, key, vars) {
  return fill(lookup(lang, key, vars), vars);
}

// th('join.noticeHtml', vars, raw) -> HTML for keys whose text contains markup (use <%- %>).
// Values in vars are escaped; values in raw are inserted as HTML (only pass markup we built).
export function translateHtml(lang, key, vars = {}, raw = {}) {
  const values = {};
  for (const [k, v] of Object.entries(vars)) values[k] = escapeHtml(v);
  return fill(lookup(lang, key, vars), { ...values, ...raw });
}

// All keys under a prefix, for the browser scripts (plural entries are sent whole).
export function section(lang, prefix) {
  const out = {};
  const add = (dict) => {
    for (const [k, v] of Object.entries(dict)) if (k.startsWith(prefix + '.')) out[k.slice(prefix.length + 1)] ??= v;
  };
  add(dictionary(lang));
  if (lang !== DEFAULT_LANGUAGE) add(dictionary(DEFAULT_LANGUAGE));
  return out;
}

// ---- numbers, dates and names

const formatters = new Map();
function cached(key, make) {
  if (!formatters.has(key)) formatters.set(key, make());
  return formatters.get(key);
}
const safeLocale = (lang) => {
  try {
    new Intl.NumberFormat(intlLocale(lang));
    return intlLocale(lang);
  } catch {
    return 'en-IE';
  }
};

export function euroFormatter(lang) {
  return cached(`euro:${lang}`, () => new Intl.NumberFormat(safeLocale(lang), { style: 'currency', currency: 'EUR' }));
}
export function dateFormatter(lang) {
  return cached(
    `date:${lang}`,
    () =>
      new Intl.DateTimeFormat(safeLocale(lang), {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Brussels',
        timeZoneName: 'short',
      })
  );
}

// EU countries in the visitor's language, sorted for a <select>: [[code, name], ...]
export function countryList(lang) {
  return cached(`countries:${lang}`, () => {
    let names;
    try {
      names = new Intl.DisplayNames([safeLocale(lang)], { type: 'region' });
    } catch {
      names = null;
    }
    const collator = new Intl.Collator(safeLocale(lang));
    return Object.keys(EU_COUNTRIES)
      .map((code) => [code, (names && names.of(code)) || EU_COUNTRIES[code]])
      .sort((a, b) => collator.compare(a[1], b[1]));
  });
}

// ---- choosing the visitor's language

export function cookieValue(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

// "de-AT,de;q=0.9,en;q=0.8" -> the best supported language, or null.
export function fromAcceptLanguage(header) {
  const wanted = String(header ?? '')
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { lang: tag.trim().toLowerCase().split('-')[0], q: q ? Number(q.slice(2)) || 0 : 1, i };
    })
    .filter((w) => w.lang && w.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  // Norwegian readers are closest to Danish; Ukrainian and Belarusian readers usually read Russian.
  const alias = { nb: 'da', nn: 'da', no: 'da', uk: 'ru', be: 'ru' };
  for (const w of wanted) {
    const code = isShopLanguage(w.lang) ? w.lang : alias[w.lang];
    if (isShopLanguage(code)) return code;
  }
  return null;
}

// ?lang=xx (a choice from the language menu, remembered in a cookie) > cookie > browser > the
// shop's main language. Only languages the shop offers count.
export function pickLanguage(req) {
  const q = typeof req.query?.lang === 'string' ? req.query.lang.toLowerCase() : '';
  if (isShopLanguage(q)) return { lang: q, chosen: true };
  const fromCookie = cookieValue(req.headers?.cookie, LANGUAGE_COOKIE);
  if (isShopLanguage(fromCookie)) return { lang: fromCookie, chosen: false };
  return { lang: fromAcceptLanguage(req.headers?.['accept-language']) ?? main, chosen: false };
}

// Helpers for code outside a request (emails, background work).
export function forLanguage(lang) {
  const code = isLanguage(lang) ? lang : DEFAULT_LANGUAGE;
  return {
    lang: code,
    t: (key, vars) => translate(code, key, vars),
    th: (key, vars, raw) => translateHtml(code, key, vars, raw),
    formatEuro: (cents) => euroFormatter(code).format((cents ?? 0) / 100),
    formatDate: (d) => (d ? dateFormatter(code).format(new Date(d)) : ''),
  };
}
