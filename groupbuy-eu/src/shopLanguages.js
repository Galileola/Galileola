import { DEFAULT_LANGUAGE, LANGUAGE_CODES, isLanguage, setShopLanguages } from './i18n/index.js';

// Admin → Settings → Languages: which of the 25 languages the shop offers. Stored in
// admin_settings; until the owner chooses, the shop offers all of them.
//
// The shop's main language (CONTENT_LANGUAGE: deals are written in it) is always on, and it is the
// first of requiredLanguages(), which visitors get when their browser's language isn't offered.
// English can be switched off for visitors; the admin stays in English.

const KEY = 'shop_languages';

export const mainLanguageOf = (config) => (isLanguage(config?.contentLanguage) ? config.contentLanguage : DEFAULT_LANGUAGE);
export const requiredLanguages = (config) => [mainLanguageOf(config)];

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
