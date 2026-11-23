import { isDeliveryCountry } from '../deliveryCountries.js';
import { guaranteeNotice } from '../guaranteeNotice.js';
import {
  LANGUAGES,
  shopLanguages,
  mainLanguage,
  LANGUAGE_COOKIE,
  countryList,
  dateFormatter,
  euroFormatter,
  ogLocale,
  pickLanguage,
  section,
  stripeLocale,
  translate,
  withoutEmoji,
  translateHtml,
} from './index.js';
import { allCategories, categoryFor, categoryName } from '../categories.js';
import { TRACKING_PARAMS } from '../analytics.js';

// Puts everything a page needs to speak the visitor's language on res.locals:
// t / th (text), formatEuro / formatDate, countries, categories, the language menu and
// localizeDeal (a deal's name and description in this language, when translated).
export function applyLanguage(req, res, lang, ctx = {}) {
  const t = (key, vars) => translate(lang, key, vars);
  const localCategory = (c) => ({ ...c, name: categoryName(c, lang, t) });

  Object.assign(res.locals, {
    lang,
    t,
    th: (key, vars, raw) => translateHtml(lang, key, vars, raw),
    // Text without decorative emoji, for the shop's calmer look (src/i18n/index.js).
    plain: withoutEmoji,
    formatEuro: (cents) => euroFormatter(lang).format((cents ?? 0) / 100),
    formatDate: (d) => (d ? dateFormatter(lang).format(new Date(d)) : ''),
    // Only the countries the shop delivers to (Admin → Settings → Delivery countries).
    countries: countryList(lang).filter(([code]) => isDeliveryCountry(code)),
    // One EU country's name in this language (downloads are sold only in Estonia: src/digital.js).
    countryName: (code) => countryList(lang).find(([c]) => c === code)?.[1] ?? code,
    // The EU harmonised notice on the legal guarantee for this language (src/guaranteeNotice.js).
    guaranteeNotice: guaranteeNotice(lang),
    categories: allCategories().map(localCategory),
    categoryFor: (slug) => localCategory(categoryFor(slug)),
    languages: shopLanguages(),
    mainLanguage: mainLanguage(),
    currentLanguage: LANGUAGES.find((l) => l.code === lang),
    stripeLocale: stripeLocale(lang),
    ogLocale: ogLocale(lang),
    // Texts the page scripts show (without decorative emoji, like the pages themselves).
    clientStrings: Object.fromEntries(Object.entries(section(lang, 'js')).map(([k, v]) => [k, typeof v === 'string' ? withoutEmoji(v) : v])),
    localizeDeal: (deal) => (ctx.translator ? ctx.translator.deal(deal, lang) : deal),
    // Link to the same page in another language. After a form post the page has no address of
    // its own, so routes set res.locals.canonicalPath (e.g. the deal page).
    langUrl: (code) => {
      const u = new URL(req.originalUrl || '/', 'http://local');
      // "/.//evil.example" resolves to the path "//evil.example", which a browser would read as a
      // link to another site: keep a single leading slash.
      const base = (req.method === 'GET' ? u.pathname : res.locals.canonicalPath || '/').replace(/^[/\\]+/, '/');
      const params = req.method === 'GET' ? u.searchParams : new URLSearchParams();
      for (const p of TRACKING_PARAMS) params.delete(p); // an ad's tags belong to the visit, not the page
      params.set('lang', code);
      return `${base}?${params}`;
    },
  });
}

export function languageMiddleware(ctx) {
  return (req, res, next) => {
    const { lang, chosen } = pickLanguage(req);
    if (chosen) {
      // A preference the visitor chose themselves: no consent needed (see the cookie page).
      const secure = req.secure ? '; Secure' : '';
      res.append('Set-Cookie', `${LANGUAGE_COOKIE}=${lang}; Max-Age=${60 * 60 * 24 * 365}; Path=/; SameSite=Lax${secure}`);
    }
    res.vary('Accept-Language');
    res.vary('Cookie');
    applyLanguage(req, res, lang, ctx);
    next();
  };
}
