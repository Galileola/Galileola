import { createTwoStep } from '../twoStep.js';

// The admin's login page, "Log out", and the check in front of every other admin page.
//
// After MAX_LOGIN_FAILURES wrong passwords from one address within LOCKOUT_MS, that address is
// refused for LOCKOUT_MS, so the password can't be guessed by trying many.
export const MAX_LOGIN_FAILURES = 10;
export const LOCKOUT_MS = 15 * 60_000;
const MAX_FIELD = 1000;

// Only paths inside the admin are followed after logging in.
export const safeNext = (value) =>
  /^\/admin(\/|\?|$)/.test(String(value ?? '')) && !/[\\]|\/\//.test(String(value)) ? String(value) : '/admin';

const loginPage = (res, status, { next = '/admin', username = '', error = '', notice = '' } = {}) => {
  res.locals.adminNav = false;
  res.status(status).render('admin/login', { title: 'Log in', next, username, error, notice });
};

// Runs before the login check: the login page itself.
export function loginRoutes(router, ctx, { auth, sessions }) {
  const { clock } = ctx;
  const failures = new Map(); // ip -> { count, first, lockedUntil }

  router.get('/login', (req, res) => {
    if (sessions.find(req)) return res.redirect(303, safeNext(req.query.next));
    loginPage(res, 200, { next: safeNext(req.query.next), notice: req.query.out ? 'You are logged out.' : '' });
  });

  router.post('/login', (req, res) => {
    const now = clock.now().getTime();
    const ip = req.ip || 'unknown';
    const next = safeNext(req.body.next);
    const username = String(req.body.username ?? '').slice(0, MAX_FIELD);
    const password = String(req.body.password ?? '').slice(0, MAX_FIELD);
    const f = failures.get(ip);
    if (f?.lockedUntil > now) {
      res.set('Retry-After', String(Math.ceil((f.lockedUntil - now) / 1000)));
      return loginPage(res, 429, { next, username, error: 'Too many wrong passwords. Try again in 15 minutes.' });
    }
    if (!username || !password) return loginPage(res, 422, { next, username, error: 'Type your user name and password.' });
    if (auth.check(username, password)) {
      failures.delete(ip);
      res.append('Set-Cookie', sessions.start({ remember: req.body.remember === '1' }));
      return res.redirect(303, next);
    }
    const entry = f && now - f.first < LOCKOUT_MS ? f : { count: 0, first: now, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= MAX_LOGIN_FAILURES) {
      entry.lockedUntil = now + LOCKOUT_MS;
      console.warn(`[admin] ${entry.count} wrong passwords from ${ip}: locked out for 15 minutes`);
    }
    failures.set(ip, entry);
    if (failures.size > 10_000) for (const [k, v] of failures) if (v.lockedUntil < now && now - v.first > LOCKOUT_MS) failures.delete(k);
    loginPage(res, 401, { next, username, error: 'Wrong user name or password.' });
  });
}

// Every other admin page needs a login. Pages open the login page and come back after it; a
// form sent after the login ended explains that it wasn't saved.
export function requireAdmin(sessions) {
  return (req, res, next) => {
    const session = sessions.find(req);
    if (session) {
      req.adminSession = session;
      return next();
    }
    if (req.method === 'GET' || req.method === 'HEAD') return res.redirect(303, `/admin/login?next=${encodeURIComponent(safeNext(req.originalUrl))}`);
    const message = 'You were logged out, so this was not saved. Log in again, then try once more.';
    // Forms sent by the browser ask for a page; the admin's scripts (Write with AI, Snap a deal)
    // read a JSON error.
    if (!/text\/html/.test(req.get('Accept') || '')) return res.status(401).json({ error: message, errors: { form: message } });
    let back = '/admin';
    try {
      const referer = new URL(req.get('Referer') || '', 'http://x');
      back = safeNext(referer.pathname + referer.search);
    } catch {
      // keep /admin
    }
    loginPage(res, 401, { next: back, notice: message });
  };
}

// Runs after the login check and the form-token check.
export function logoutRoutes(router, ctx, { sessions }) {
  const twoStep = (ctx.twoStep ??= createTwoStep(ctx));
  // Ends the login on the server and in this browser, and forgets the two-step code here too:
  // the next login on this device needs the password (and the code) again.
  router.post('/logout', (req, res) => {
    sessions.end(req);
    res.append('Set-Cookie', sessions.clearCookie());
    res.append('Set-Cookie', twoStep.clearCookie());
    res.redirect(303, '/admin/login?out=1');
  });
}
