import crypto from 'node:crypto';
import { randomToken, readCookie, safeEqual } from './util.js';

// Admin logins (the login page, src/routes/adminLogin.js).
//
// A successful login gets a random session token in a cookie. The server keeps only a hash of
// it, in admin_settings, so "Log out" really ends the login: the token stops working even if
// it was copied. A login lasts 12 hours, or 30 days when "Keep me logged in" is ticked. Changing
// the admin password (in the admin or in the hosting panel) ends every login made before.

export const COOKIE = 'gb_admin';
const PREFIX = 'admin_session:';
export const SESSION_MS = 12 * 3600_000;
export const REMEMBER_MS = 30 * 24 * 3600_000;

const keyFor = (token) => PREFIX + crypto.createHash('sha256').update(token).digest('base64url');

export function createAdminSessions({ config, repo, clock, auth }) {
  const secure = /^https:/.test(config.baseUrl || '') ? '; Secure' : '';
  // SameSite=Lax (not Strict) so links to the admin in the shop's emails open logged in. Forms
  // are still protected by the admin's form token.
  const cookie = (token, maxAge) =>
    `${COOKIE}=${token}; Path=/admin; HttpOnly; SameSite=Lax${maxAge === undefined ? '' : `; Max-Age=${maxAge}`}${secure}`;
  const tokenOf = (req) => {
    const token = readCookie(req, COOKIE);
    return /^[\w-]{20,100}$/.test(token) ? token : '';
  };

  return {
    // Starts a login and returns the Set-Cookie value for it.
    start({ remember = false } = {}) {
      const now = clock.now();
      // Logins are at most 30 days old, so older rows are only expired ones.
      repo.deleteAdminSettingsBefore(PREFIX, new Date(now.getTime() - REMEMBER_MS).toISOString());
      const token = randomToken(32);
      const expires = now.getTime() + (remember ? REMEMBER_MS : SESSION_MS);
      repo.setAdminSetting(keyFor(token), JSON.stringify({ expires, remember, version: auth.version() }), now.toISOString());
      return cookie(token, remember ? Math.floor(REMEMBER_MS / 1000) : undefined);
    },
    // The login this request belongs to, or null.
    find(req) {
      const token = tokenOf(req);
      if (!token) return null;
      const row = repo.getAdminSetting(keyFor(token));
      if (!row) return null;
      try {
        const s = JSON.parse(row.value);
        if (!(s.expires > clock.now().getTime()) || !safeEqual(s.version, auth.version())) return null;
        return { expires: s.expires, remember: Boolean(s.remember) };
      } catch {
        return null;
      }
    },
    // Ends this request's login.
    end(req) {
      const token = tokenOf(req);
      if (token) repo.deleteAdminSetting(keyFor(token));
    },
    // Ends every login, on every device.
    endAll: () => repo.deleteAdminSettingsBefore(PREFIX, '9999'),
    clearCookie: () => cookie('', 0),
  };
}
