import { currentBrand } from '../branding.js';
import { MIN_PASSWORD_LENGTH, newPasswordProblem } from '../adminPassword.js';
import { createPasswordReset, maskEmail } from '../passwordReset.js';
import { createRateLimiter } from '../rateLimit.js';

// "Forgot your password?" (src/passwordReset.js): open to everyone, like the login page.
export function passwordResetRoutes(router, ctx, { auth, sessions }) {
  const { config, clock } = ctx;
  const reset = createPasswordReset({ config, repo: ctx.repo, clock, auth });
  // Someone else pressing the button can't flood the admin's inbox.
  const perVisitor = createRateLimiter({ windowMs: 15 * 60_000, max: 3, clock });
  const overall = createRateLimiter({ windowMs: 60 * 60_000, max: 10, clock });
  const emailing = () => Boolean(ctx.mailer?.delivers);

  const forgotPage = (res, status, extra = {}) => {
    res.locals.adminNav = false;
    res.status(status).render('admin/forgot', {
      title: 'Forgot your password?',
      emailing: emailing(),
      masked: maskEmail(reset.address()),
      sent: false,
      error: '',
      ...extra,
    });
  };

  router.get('/forgot', (req, res) => forgotPage(res, 200));

  router.post('/forgot', async (req, res) => {
    const to = reset.address();
    if (!emailing() || !to) return forgotPage(res, 422);
    if (!perVisitor.take(req.ip || 'unknown') || !overall.take('all')) {
      return forgotPage(res, 429, { error: 'Too many reset emails. Wait 15 minutes, then try again.' });
    }
    const token = reset.start();
    const name = currentBrand(config).name;
    const text = (link) =>
      [
        `Someone (hopefully you) asked to reset the admin password of ${name} (${config.baseUrl}).`,
        '',
        'Choose a new password here. The link works once, for the next 30 minutes:',
        link,
        '',
        `Didn't ask for this? Ignore this email: your password stays as it is. The request came from the internet address ${req.ip}.`,
      ].join('\n');
    await ctx.mailer.send({
      kind: 'adminPasswordReset',
      to,
      subject: `Reset your admin password · ${name}`,
      body: text(`${config.baseUrl}/admin/reset?token=${token}`),
      outboxBody: text('(the link is left out of the outbox)'),
    });
    forgotPage(res, 200, { sent: true });
  });

  const resetPage = (res, status, extra = {}) => {
    res.locals.adminNav = false;
    res.status(status).render('admin/reset', {
      title: 'Choose a new password',
      minLength: MIN_PASSWORD_LENGTH,
      adminUser: config.adminUser,
      token: '',
      expired: false,
      error: '',
      ...extra,
    });
  };

  router.get('/reset', (req, res) => {
    const token = String(req.query.token ?? '');
    if (!reset.valid(token)) return resetPage(res, 410, { expired: true });
    resetPage(res, 200, { token });
  });

  router.post('/reset', (req, res) => {
    const token = String(req.body.token ?? '');
    if (!reset.valid(token)) return resetPage(res, 410, { expired: true });
    const next = String(req.body.new_password ?? '');
    const repeat = String(req.body.repeat_password ?? '');
    const problem =
      newPasswordProblem({ current: '', next, repeat }) ||
      (auth.checkPassword(next) ? 'That is already your password, so you can log in with it.' : '');
    if (problem) return resetPage(res, 422, { token, error: problem });
    reset.use(token, next);
    // Every device that was logged in is logged out; this browser is logged in with the new
    // password (two-step login, when it's on, still asks for the code).
    sessions.endAll();
    res.append('Set-Cookie', sessions.start());
    res.redirect(303, `/admin?flash=${encodeURIComponent('Your new password is saved and you are logged in. Other devices were logged out.')}`);
  });
}
