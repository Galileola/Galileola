import crypto from 'node:crypto';
import qrcode from 'qrcode-generator';
import { hmac, readCookie, safeEqual } from './util.js';

// Two-step login for the admin (Admin → Settings → Two-step login).
//
// After the browser's password prompt, the admin asks for a 6-digit code from an authenticator
// app (Google Authenticator, Microsoft Authenticator, 1Password, Authy …): standard TOTP,
// RFC 6238, 30-second codes. Ten one-time backup codes cover a lost phone. A signed cookie
// remembers the code for this browser (12 hours, or 30 days when ticked). Each code works once.
//
// Locked out (lost phone and backup codes)? Set ADMIN_TWO_STEP=off in the hosting panel and
// restart: the password alone works again until you turn two-step login back on.

const KEY = 'admin_two_step'; // { secret, enabledAt, backup: [hmac], lastStep }
const PENDING_KEY = 'admin_two_step_pending'; // { secret, createdAt } while it's being set up
export const COOKIE = 'gb_admin_2fa';
const STEP_SECONDS = 30;
const SESSION_MS = 12 * 3600_000;
export const REMEMBER_MS = 30 * 24 * 3600_000;
const PENDING_MS = 30 * 60_000;
export const BACKUP_CODES = 10;

// ---- RFC 4648 base32 (what authenticator apps expect for the secret)
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Not a base32 secret.');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ---- TOTP
export function totp(secret, timeMs, { digits = 6, step = STEP_SECONDS } = {}) {
  return hotp(secret, Math.floor(timeMs / 1000 / step), digits);
}
function hotp(secret, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = mac[mac.length - 1] & 15;
  const n = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(n).padStart(digits, '0');
}
// The time step a code belongs to (this one, the one before or the one after, for clocks that are
// a little off), or null. Steps up to lastStep were already used.
export function matchTotp(secret, code, timeMs, lastStep = -1) {
  const clean = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const now = Math.floor(timeMs / 1000 / STEP_SECONDS);
  for (const step of [now, now - 1, now + 1]) {
    if (step > lastStep && safeEqual(hotp(secret, step), clean)) return step;
  }
  return null;
}

export const newSecret = () => base32Encode(crypto.randomBytes(20));

export function otpauthUrl({ secret, issuer, account }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

export function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true, alt: 'QR code for your authenticator app' });
}

// Backup codes look like "k7m2-9qxt": no 0/o, 1/l/i to mix up.
const CODE_CHARS = '23456789abcdefghjkmnpqrstuvwxyz';
function newBackupCode() {
  const bytes = crypto.randomBytes(8);
  const s = [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
const normaliseBackup = (code) => String(code ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// The app's secret is stored encrypted (AES-256-GCM with a key derived from APP_SECRET), so a
// copy of the database alone doesn't reveal it. Changing APP_SECRET makes it unreadable: then use
// ADMIN_TWO_STEP=off and set two-step login up again.
const keyFor = (appSecret) => crypto.createHash('sha256').update(`admin-two-step-key:${appSecret}`).digest();
export function sealSecret(appSecret, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(appSecret), iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url')}`;
}
export function openSecret(appSecret, sealed) {
  if (!String(sealed).startsWith('v1:')) return sealed; // stored before encryption existed
  try {
    const buf = Buffer.from(String(sealed).slice(3), 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(appSecret), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function createTwoStep({ config, repo, clock }) {
  const read = (key) => {
    try {
      const row = repo.getAdminSetting(key);
      return row ? JSON.parse(row.value) : null;
    } catch {
      return null;
    }
  };
  const write = (key, value) =>
    repo.setAdminSetting(key, JSON.stringify({ ...value, secret: sealSecret(config.appSecret, value.secret) }), clock.now().toISOString());
  const unseal = (s) => {
    if (!s?.secret) return null;
    const secret = openSecret(config.appSecret, s.secret);
    return secret ? { ...s, secret } : { ...s, secret: null, unreadable: true };
  };
  // Turned on, with its secret readable (an unreadable one locks the admin until ADMIN_TWO_STEP=off).
  const stored = () => {
    const s = unseal(read(KEY));
    return s?.secret || s?.unreadable ? s : null;
  };
  const backupHash = (code) => hmac(config.appSecret, `admin-backup-code:${normaliseBackup(code)}`);
  // Changes whenever two-step login is turned on again, so older "remember me" cookies stop working.
  const version = (s) => hmac(config.appSecret, `admin-2fa-version:${s.secret ?? 'unreadable'}:${s.enabledAt}`).slice(0, 16);
  const switchedOff = () => config.adminTwoStep === 'off';

  const api = {
    switchedOff,
    enabled: () => !switchedOff() && Boolean(stored()),
    status() {
      const s = stored();
      return { enabled: Boolean(s), switchedOff: switchedOff(), enabledAt: s?.enabledAt ?? null, backupLeft: s?.backup?.length ?? 0 };
    },

    // Step 1 of turning it on: a new secret, shown as a QR code and as text.
    startSetup(issuerName = 'Group Buy') {
      const pending = { secret: newSecret(), createdAt: clock.now().toISOString() };
      write(PENDING_KEY, pending);
      return api.pendingSetup(issuerName);
    },
    pendingSetup(issuerName = 'Group Buy') {
      const p = unseal(read(PENDING_KEY));
      if (!p?.secret || clock.now() - new Date(p.createdAt) > PENDING_MS) return null;
      const url = otpauthUrl({ secret: p.secret, issuer: issuerName, account: config.adminUser || 'admin' });
      return { secret: p.secret, grouped: p.secret.match(/.{1,4}/g).join(' '), url, svg: qrSvg(url) };
    },
    // Step 2: the first code from the app proves it was set up. Returns the backup codes (shown
    // once), or null when the code is wrong.
    confirmSetup(code) {
      const p = unseal(read(PENDING_KEY));
      if (!p?.secret || clock.now() - new Date(p.createdAt) > PENDING_MS) return null;
      const step = matchTotp(p.secret, code, clock.now().getTime());
      if (step === null) return null;
      const codes = Array.from({ length: BACKUP_CODES }, newBackupCode);
      write(KEY, { secret: p.secret, enabledAt: clock.now().toISOString(), backup: codes.map(backupHash), lastStep: step });
      repo.deleteAdminSetting(PENDING_KEY);
      return codes;
    },

    // A code from the app, or a backup code (each works once). Returns
    // { ok, backup: true when a backup code was used, backupLeft }.
    verify(code) {
      const s = stored();
      if (!s || !s.secret) return { ok: false };
      const step = matchTotp(s.secret, code, clock.now().getTime(), s.lastStep ?? -1);
      if (step !== null) {
        write(KEY, { ...s, lastStep: step });
        return { ok: true, backup: false, backupLeft: s.backup.length };
      }
      const h = backupHash(code);
      if (normaliseBackup(code).length === 8 && s.backup.some((b) => safeEqual(b, h))) {
        const backup = s.backup.filter((b) => !safeEqual(b, h));
        write(KEY, { ...s, backup });
        return { ok: true, backup: true, backupLeft: backup.length };
      }
      return { ok: false };
    },
    newBackupCodes() {
      const s = stored();
      if (!s) return null;
      const codes = Array.from({ length: BACKUP_CODES }, newBackupCode);
      write(KEY, { ...s, backup: codes.map(backupHash) });
      return codes;
    },
    disable() {
      repo.deleteAdminSetting(KEY);
      repo.deleteAdminSetting(PENDING_KEY);
    },

    // ---- the cookie that remembers a passed second step in this browser
    cookie({ remember = false } = {}) {
      const s = stored();
      const exp = clock.now().getTime() + (remember ? REMEMBER_MS : SESSION_MS);
      const v = version(s);
      const value = `${exp}.${hmac(config.appSecret, `admin-2fa:${exp}:${v}`)}`;
      const secure = /^https:/.test(config.baseUrl || '') ? '; Secure' : '';
      const maxAge = remember ? `; Max-Age=${Math.floor(REMEMBER_MS / 1000)}` : '';
      return `${COOKIE}=${value}; Path=/admin; HttpOnly; SameSite=Strict${maxAge}${secure}`;
    },
    clearCookie() {
      return `${COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0`;
    },
    passed(req) {
      const s = stored();
      if (!s) return true;
      const [exp, sig] = readCookie(req, COOKIE).split('.');
      if (!exp || !sig || Number(exp) < clock.now().getTime()) return false;
      return safeEqual(sig, hmac(config.appSecret, `admin-2fa:${exp}:${version(s)}`));
    },
  };
  return api;
}
