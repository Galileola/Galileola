import { DEFAULT_LANGUAGE, LANGUAGE_CODES, isLanguage, setShopLanguages } from './i18n/index.js';

// Admin → Settings → Languages: which of the 25 languages the shop offers. Stored in
// admin_settings; until the owner chooses, the shop offers all of them.
//
// English is always on (the admin, the built-in legal texts and any missing translation use it),
// and so is the language deals are written in (CONTENT_LANGUAGE).

const KEY = 'shop_languages';

export const requiredLanguages = (config) => [...new Set([DEFAULT_LANGUAGE, config?.contentLanguage].filter(isLanguage))];

// The codes the owner chose, or null when they never did (all languages).
export function savedShopLanguages(repo) {
  try {
    const codes = JSON.parse(repo?.getAdminSetting?.(KEY)?.value || 'null');
    return Array.isArray(codes) ? codes.filter(isLanguage) : null;
  } catch {
    return null;
  }
}

export function loadShopLanguages(repo, config) {
  setShopLanguages(savedShopLanguages(repo) ?? LANGUAGE_CODES, requiredLanguages(config));
}

export function saveShopLanguages(repo, config, codes, now) {
  const chosen = [...new Set([...[].concat(codes ?? []).filter(isLanguage), ...requiredLanguages(config)])];
  repo.setAdminSetting(KEY, JSON.stringify(chosen), now);
  loadShopLanguages(repo, config);
  return chosen;
}
