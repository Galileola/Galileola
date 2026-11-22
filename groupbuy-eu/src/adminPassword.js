import crypto from 'node:crypto';
import { hmac, safeEqual } from './util.js';

// The admin password.
//
// It starts as ADMIN_PASSWORD (hosting panel or the shared settings file). The admin can change
// it on /admin/password: the new one is typed in the browser, sent over HTTPS and stored only as
// a salted scrypt hash in the database.
//
// Forgot the changed password? Set a new ADMIN_PASSWORD in the hosting panel: each stored hash
// remembers which ADMIN_PASSWORD it replaced, so a different one takes over again.

const KEY = 'admin_password';
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function verifyPassword(password, stored) {
  const [kind, n, r, p, salt, hash] = String(stored).split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

// True when the admin password was changed in the admin (and still replaces ADMIN_PASSWORD).
export function passwordChangedInAdmin(config, repo) {
  try {
    const value = JSON.parse(repo?.getAdminSetting?.(KEY)?.value || 'null');
    return Boolean(value?.hash && value.env === hmac(config.appSecret, `admin-env-password:${config.adminPassword}`));
  } catch {
    return false;
  }
}

export function createAdminAuth({ config, repo, clock }) {
  // Identifies the ADMIN_PASSWORD a stored hash replaced, without storing anything that reveals
  // it (keyed with APP_SECRET, which isn't in the database).
  const envMark = hmac(config.appSecret, `admin-env-password:${config.adminPassword}`);

  function stored() {
    const row = repo.getAdminSetting(KEY);
    if (!row) return null;
    try {
      const value = JSON.parse(row.value);
      return value.env === envMark && value.hash ? value : null;
    } catch {
      return null;
    }
  }

  function passwordOk(pass) {
    const s = stored();
    return s ? verifyPassword(pass, s.hash) : safeEqual(pass, config.adminPassword);
  }

  return {
    changedInAdmin: () => Boolean(stored()),
    // Checks a login (user and password).
    check(user, pass) {
      const userOk = safeEqual(user, config.adminUser);
      return passwordOk(pass) && userOk;
    },
    checkPassword: passwordOk,
    change(newPassword) {
      repo.setAdminSetting(KEY, JSON.stringify({ hash: hashPassword(newPassword), env: envMark }), clock.now().toISOString());
    },
    // Changes whenever the user name or the password changes (in the admin or in the hosting
    // panel), so logins made with the old password end (src/adminSession.js).
    version: () => hmac(config.appSecret, `admin-login:${config.adminUser}\0${stored()?.hash ?? `env:${envMark}`}`).slice(0, 22),
  };
}

// Returns an error message, or '' when the new password can be used.
export function newPasswordProblem({ current, next, repeat }) {
  if (next.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (next.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (next !== repeat) return "The two new passwords don't match.";
  if (next === current) return 'The new password is the same as the current one.';
  return '';
}
