import { isValidEmail } from './util.js';

// The shop's company details (Admin → Settings → Shop details). They appear in the footer, the
// legal pages, the emails and the AI prompts. Values saved in the admin win; an empty field falls
// back to the environment variable (BUSINESS_NAME …) and then to a [placeholder].
export const BUSINESS_FIELDS = [
  { key: 'name', label: 'Company name', env: 'BUSINESS_NAME', hint: 'Shown at the top of the shop, in the footer, in emails and in the legal pages.' },
  { key: 'address', label: 'Company address', env: 'BUSINESS_ADDRESS', hint: 'Street and number, postcode, city, country.' },
  { key: 'email', label: 'Customer contact email', env: 'BUSINESS_EMAIL', hint: 'Where customers write to you, for example about a withdrawal.' },
  { key: 'phone', label: 'Customer phone number', env: 'BUSINESS_PHONE', hint: 'EU consumer law asks for a phone number next to your address and email, for example +372 5123 4567. Shown in the footer, the terms and the emails.' },
  { key: 'vatId', label: 'EU VAT number', env: 'BUSINESS_VAT_ID', hint: 'For example EE123456789.' },
  { key: 'registration', label: 'Company register and number', env: 'BUSINESS_REGISTRATION', hint: 'For example: Estonian Commercial Register, registry code 12345678.' },
  { key: 'supervisoryAuthority', label: 'National data protection authority', env: 'BUSINESS_DPA', hint: 'Named in the privacy policy as where customers can complain, for example the Estonian Data Protection Inspectorate (AKI).' },
];
const KEY = 'business';
const MAX = 300;

export function savedBusinessSettings(repo) {
  try {
    const data = JSON.parse(repo?.getAdminSetting?.(KEY)?.value || '{}');
    const out = {};
    for (const f of BUSINESS_FIELDS) if (typeof data[f.key] === 'string' && data[f.key].trim()) out[f.key] = data[f.key].trim();
    return out;
  } catch {
    return {};
  }
}

// Puts the saved details into config.business (the same object every page and email reads).
export function applyBusinessSettings(config, repo) {
  if (!config?.business) return;
  if (!config.businessFromEnv) config.businessFromEnv = { ...config.business };
  Object.assign(config.business, config.businessFromEnv, savedBusinessSettings(repo));
}

// body: form fields named like BUSINESS_FIELDS keys. Returns { errors, values }.
export function saveBusinessSettings(config, repo, body, now) {
  const values = {};
  const errors = {};
  for (const f of BUSINESS_FIELDS) {
    const v = String(body[f.key] ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (v.length > MAX) errors[f.key] = `At most ${MAX} characters.`;
    if (v) values[f.key] = v;
  }
  if (values.email && !isValidEmail(values.email)) errors.email = 'Enter a valid email address.';
  if (values.phone && !/^\+?[\d\s().\/-]{6,30}$/.test(values.phone)) errors.phone = 'Enter a phone number, for example +372 5123 4567.';
  if (Object.keys(errors).length) return { errors, values };
  repo.setAdminSetting(KEY, JSON.stringify(values), now);
  applyBusinessSettings(config, repo);
  return { errors, values };
}

export const isPlaceholder = (v) => !v || String(v).startsWith('[');
