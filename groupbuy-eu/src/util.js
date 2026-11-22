import crypto from 'node:crypto';

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
export const GRACE_WINDOW_MS = 48 * HOUR;
export const MAX_DEAL_DURATION_MS = 30 * DAY;

// EU member states (ISO 3166-1 alpha-2). Stripe uses "GR" for Greece.
export const EU_COUNTRIES = {
  AT: 'Austria', BE: 'Belgium', BG: 'Bulgaria', HR: 'Croatia', CY: 'Cyprus', CZ: 'Czechia',
  DK: 'Denmark', EE: 'Estonia', FI: 'Finland', FR: 'France', DE: 'Germany', GR: 'Greece',
  HU: 'Hungary', IE: 'Ireland', IT: 'Italy', LV: 'Latvia', LT: 'Lithuania', LU: 'Luxembourg',
  MT: 'Malta', NL: 'Netherlands', PL: 'Poland', PT: 'Portugal', RO: 'Romania', SK: 'Slovakia',
  SI: 'Slovenia', ES: 'Spain', SE: 'Sweden',
};

export const systemClock = { now: () => new Date() };

export const iso = (d) => new Date(d).toISOString();
export const addMs = (d, ms) => new Date(new Date(d).getTime() + ms);

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function slugify(text) {
  const base = String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `${base || 'deal'}-${crypto.randomBytes(3).toString('hex')}`;
}

const euroFormat = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
export const formatEuro = (cents) => euroFormat.format((cents ?? 0) / 100);

// "49", "49.9", "49,90", "1.299,00" -> integer cents. Returns NaN when invalid.
export function parseEuroToCents(input) {
  let s = String(input ?? '').trim().replace(/\s|€/g, '');
  if (!s) return NaN;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Brussels',
  timeZoneName: 'short',
});
export const formatDate = (d) => (d ? dateFormat.format(new Date(d)) : '');

export function hmac(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

// The value of one cookie from the request, or ''.
export function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return '';
      }
    }
  }
  return '';
}

export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}
