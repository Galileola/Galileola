import { createTwoStep } from '../twoStep.js';
import { currentBrand } from '../branding.js';
import { safeNext } from './adminLogin.js';

// Two-step login (src/twoStep.js): the code page after the password, and Admin → Settings →
// Two-step login to turn it on or off and get new backup codes.

const MAX_WRONG_CODES = 5;
const WRONG_CODE_WINDOW_MS = 15 * 60_000;

// Runs right after the password check: with two-step login on, every admin page needs a passed
// second step in this browser (the code page and "Log out" excepted).
export function twoStepGate(ctx) {
  const twoStep = (ctx.twoStep ??= createTwoStep(ctx));
  return (req, res, next) => {
    res.locals.twoStepOn = twoStep.enabled();
    if (!res.locals.twoStepOn || req.path === '/two-step' || req.path === '/logout' || twoStep.passed(req)) return next();
    const back = req.method === 'GET' ? req.originalUrl : '/admin';
    res.set('Cache-Control', 'no-store');
    res.redirect(303, `/admin/two-step?next=${encodeURIComponent(back)}`);
  };
}

export function twoStepRoutes(router, ctx) {
  const { config, clock } = ctx;
  const twoStep = (ctx.twoStep ??= createTwoStep(ctx));
  const wrong = new Map(); // ip -> { count, first }
  const blocked = (ip) => {
    const w = wrong.get(ip);
    return Boolean(w && clock.now() - w.first < WRONG_CODE_WINDOW_MS && w.count >= MAX_WRONG_CODES);
  };
  const failed = (ip) => {
    const now = clock.now().getTime();
    const w = wrong.get(ip);
    const entry = w && now - w.first < WRONG_CODE_WINDOW_MS ? w : { count: 0, first: now };
    entry.count += 1;
    wrong.set(ip, entry);
    if (wrong.size > 10_000) wrong.clear();
  };
  const issuer = () => currentBrand(config).name;

  // ---- the second step
  const codePage = (res, status, { next = '/admin', error = '' } = {}) =>
    res.status(status).render('admin/two-step', { title: 'Two-step login', next, error });

  router.get('/two-step', (req, res) => {
    if (!twoStep.enabled()) return res.redirect(303, '/admin');
    if (twoStep.passed(req)) return res.redirect(303, safeNext(req.query.next));
    codePage(res, 200, { next: safeNext(req.query.next) });
  });

  router.post('/two-step', (req, res) => {
    const next = safeNext(req.body.next);
    if (!twoStep.enabled()) return res.redirect(303, '/admin');
    if (blocked(req.ip)) return codePage(res, 429, { next, error: 'Too many wrong codes. Wait 15 minutes and try again.' });
    const result = twoStep.verify(req.body.code);
    if (!result.ok) {
      failed(req.ip);
      return codePage(res, 401, { next, error: "That code didn't work. Check that your phone's clock is right and use the newest code, or a backup code." });
    }
    wrong.delete(req.ip);
    res.append('Set-Cookie', twoStep.cookie({ remember: req.body.remember === '1' }));
    const flash = result.backup
      ? `Backup code used: ${result.backupLeft} left.${result.backupLeft <= 3 ? ' Get new ones in Settings → Two-step login.' : ''}`
      : '';
    res.redirect(303, flash ? `/admin/security?flash=${encodeURIComponent(flash)}` : next);
  });

  // ---- settings
  const settingsPage = (res, status, extra = {}) =>
    res.status(status).render('admin/security', {
      title: 'Two-step login',
      adminUser: config.adminUser || 'admin',
      status: twoStep.status(),
      setup: null,
      backupCodes: null,
      error: '',
      flash: '',
      ...extra,
    });

  router.get('/security', (req, res) => settingsPage(res, 200, { flash: req.query.flash || '' }));

  router.post('/security/start', (req, res) => {
    if (twoStep.status().enabled) return res.redirect(303, '/admin/security');
    settingsPage(res, 200, { setup: twoStep.startSetup(issuer()) });
  });

  router.post('/security/confirm', (req, res) => {
    const setup = twoStep.pendingSetup(issuer());
    if (!setup) return settingsPage(res, 410, { error: 'The setup timed out. Start again.' });
    const codes = twoStep.confirmSetup(req.body.code);
    if (!codes) return settingsPage(res, 422, { setup, error: "That code didn't match. Check that your phone's clock is right and type the newest code." });
    // This browser has just proved it has the code.
    res.append('Set-Cookie', twoStep.cookie());
    settingsPage(res, 200, { backupCodes: codes, flash: 'Two-step login is on.' });
  });

  router.post('/security/backup-codes', (req, res) => {
    const result = twoStep.verify(req.body.code);
    if (!result.ok) return settingsPage(res, 422, { error: "That code didn't work, so no new backup codes were made." });
    settingsPage(res, 200, { backupCodes: twoStep.newBackupCodes(), flash: 'New backup codes made. The old ones no longer work.' });
  });

  router.post('/security/disable', (req, res) => {
    const result = twoStep.verify(req.body.code);
    if (!result.ok) return settingsPage(res, 422, { error: "That code didn't work, so two-step login is still on." });
    twoStep.disable();
    res.append('Set-Cookie', twoStep.clearCookie());
    res.redirect(303, `/admin/security?flash=${encodeURIComponent('Two-step login is off. The password alone opens the admin again.')}`);
  });
}
