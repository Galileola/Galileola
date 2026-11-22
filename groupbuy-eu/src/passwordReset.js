import crypto from 'node:crypto';
import { isPlaceholder } from './businessSettings.js';
import { isValidEmail, randomToken, safeEqual } from './util.js';

// "Forgot your password?" on the admin login page (src/routes/adminForgot.js).
//
// The reset link goes by email to ADMIN_EMAIL, or else to the shop's contact email. It works
// once, for 30 minutes, and only the newest link works. The server keeps only a hash of it, and
// it stops working as soon as the password changes in any other way.

const KEY = 'admin_password_reset'; // { hash, expires, version }
export const RESET_MS = 30 * 60_000;

const hashOf = (token) => crypto.createHash('sha256').update(String(token)).digest('base64url');

// The address reset links go to, or '' when there is none.
export function resetAddress(config) {
  for (const candidate of [config.adminEmail, config.business?.email]) {
    const email = String(candidate ?? '').trim();
    if (!isPlaceholder(email) && isValidEmail(email)) return email;
  }
  return '';
}

// "a•••@example.com": enough to recognise the mailbox, not enough to learn it.
export function maskEmail(email) {
  const [user, domain] = String(email).split('@');
  return domain ? `${user.slice(0, 1)}•••@${domain}` : '';
}

export function createPasswordReset({ config, repo, clock, auth }) {
  const valid = (token) => {
    if (!/^[\w-]{20,100}$/.test(String(token ?? ''))) return false;
    try {
      const s = JSON.parse(repo.getAdminSetting(KEY)?.value || 'null');
      return Boolean(s && s.expires > clock.now().getTime() && safeEqual(s.hash, hashOf(token)) && safeEqual(s.version, auth.version()));
    } catch {
      return false;
    }
  };
  return {
    address: () => resetAddress(config),
    // A new link (any older one stops working). Returns the token for the link.
    start() {
      const token = randomToken(32);
      const now = clock.now();
      repo.setAdminSetting(KEY, JSON.stringify({ hash: hashOf(token), expires: now.getTime() + RESET_MS, version: auth.version() }), now.toISOString());
      return token;
    },
    valid,
    // Sets the new password if the link still works. Returns true when it did.
    use(token, newPassword) {
      if (!valid(token)) return false;
      repo.deleteAdminSetting(KEY);
      auth.change(newPassword);
      return true;
    },
  };
}
