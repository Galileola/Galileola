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

export function createAdminAuth({ config, repo, clock }) {
  // Identifies the ADMIN_PASSWORD a stored hash replaced, without storing anything that reveals
  // it (keyed with APP_SECRET, which isn't in the database).
  const envMark = hmac(config.appSecret, `admin-env-password:${config.adminPassword}`);
  // Browsers send the login with every admin request; remember good ones for a few minutes so
  // scrypt doesn't run on each page.
  const recent = new Map();
  const cacheKey = (user, pass) => crypto.createHash('sha256').update(`${user}\0${pass}`).digest('base64');

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
      const key = cacheKey(user, pass);
      if (userOk && (recent.get(key) ?? 0) > Date.now()) return true;
      const ok = passwordOk(pass) && userOk;
      if (ok) {
        if (recent.size > 50) recent.clear();
        recent.set(key, Date.now() + 5 * 60_000);
      }
      return ok;
    },
    checkPassword: passwordOk,
    change(newPassword) {
      repo.setAdminSetting(KEY, JSON.stringify({ hash: hashPassword(newPassword), env: envMark }), clock.now().toISOString());
      recent.clear();
    },
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
