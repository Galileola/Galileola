import { EU_COUNTRIES } from './util.js';

// Admin → Settings → Delivery countries: the EU countries the shop delivers to. Only these are in
// the order form's country list and accepted when someone joins a deal, and the shopping
// assistant names them. Stored in admin_settings; until the owner saves the page,
// DELIVERY_COUNTRIES applies (config.deliveryCountries, default Estonia). Buyers who already
// joined keep their orders.

const KEY = 'delivery_countries';
export const ALL_COUNTRIES = Object.keys(EU_COUNTRIES);
const isEuCountry = (code) => typeof code === 'string' && Object.hasOwn(EU_COUNTRIES, code);
const clean = (codes) => [...new Set([].concat(codes ?? []).map((c) => String(c).toUpperCase()).filter(isEuCountry))];

let current = new Set(ALL_COUNTRIES);
export const deliveryCountries = () => ALL_COUNTRIES.filter((c) => current.has(c));
export const isDeliveryCountry = (code) => isEuCountry(code) && current.has(code);

// The codes the owner chose, or null when they never did.
export function savedDeliveryCountries(repo) {
  try {
    const codes = JSON.parse(repo?.getAdminSetting?.(KEY)?.value || 'null');
    return Array.isArray(codes) && clean(codes).length ? clean(codes) : null;
  } catch {
    return null;
  }
}

export function loadDeliveryCountries(repo, config) {
  const fallback = clean(config?.deliveryCountries);
  current = new Set(savedDeliveryCountries(repo) ?? (fallback.length ? fallback : ALL_COUNTRIES));
}

// Returns the saved codes, or null when none of them is an EU country (nothing is saved then).
export function saveDeliveryCountries(repo, config, codes, now) {
  const chosen = clean(codes);
  if (!chosen.length) return null;
  repo.setAdminSetting(KEY, JSON.stringify(chosen), now);
  loadDeliveryCountries(repo, config);
  return chosen;
}

// "DELIVERY_COUNTRIES=EE,LV,FI" → ['EE', 'LV', 'FI'] (Estonia when empty).
export function parseDeliveryCountries(value) {
  const codes = clean(String(value ?? '').split(/[\s,;]+/));
  return codes.length ? codes : ['EE'];
}
