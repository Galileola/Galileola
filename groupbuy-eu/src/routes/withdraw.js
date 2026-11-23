import { createRateLimiter } from '../rateLimit.js';
import { isShopLanguage } from '../i18n/index.js';
import { applyLanguage } from '../i18n/middleware.js';
import { LIMITS, submitWithdrawal, validateWithdrawal } from '../withdrawals.js';

// /withdraw: the online withdrawal function (src/withdrawals.js). "Withdraw from contract here" in
// the footer of every page, on the buyer's order page and in the order emails opens it; the form
// ends with "Confirm withdrawal".
export function withdrawRoutes(app, ctx) {
  const { repo, clock } = ctx;
  // Generous: the function must stay available; this only stops floods.
  const limiter = createRateLimiter({ windowMs: 15 * 60_000, max: 10, clock });

  // The order behind the buyer's own link (?order=<token> or the form's hidden field), or null.
  const orderOf = (token) => {
    const value = String(token ?? '');
    if (!/^[\w-]{20,100}$/.test(value)) return null;
    const p = repo.participantByToken(value);
    return p && !p.erased_at ? p : null;
  };

  const page = (req, res, status, { p = null, values = {}, errors = {} } = {}) => {
    const { t, localizeDeal } = res.locals;
    res.set('Cache-Control', 'no-store');
    res.locals.noindex = true;
    const deal = p ? localizeDeal(repo.dealById(p.deal_id)) : null;
    res.status(status).render('withdraw', {
      title: t('withdraw.title'),
      order: p ? { token: p.token, label: t('withdraw.orderKnown', { id: p.id, name: deal.product_name }) } : null,
      values: { name: p?.name ?? '', email: p?.email ?? '', ...values },
      errors,
      limits: LIMITS,
      done: null,
    });
  };

  app.get('/withdraw', (req, res) => page(req, res, 200, { p: orderOf(req.query.order) }));

  app.post('/withdraw', async (req, res, next) => {
    try {
      if (isShopLanguage(req.body.lang) && req.body.lang !== res.locals.lang) applyLanguage(req, res, req.body.lang, ctx);
      const { t, lang } = res.locals;
      const p = orderOf(req.body.order_token);
      // Bots fill in every field; people don't see this one.
      if (req.body.website) return page(req, res, 200, { p });
      const { input, errors } = validateWithdrawal(req.body, t, { known: Boolean(p) });
      if (Object.keys(errors).length) return page(req, res, 422, { p, values: req.body, errors });
      if (!limiter.take(req.ip || 'unknown')) return page(req, res, 429, { p, values: req.body, errors: { form: t('withdraw.tooMany') } });
      const { withdrawal, outcome } = await submitWithdrawal(ctx, { participant: p, input, lang });
      res.set('Cache-Control', 'no-store');
      res.locals.noindex = true;
      res.render('withdraw', {
        title: t('withdraw.doneTitle'),
        order: null,
        values: {},
        errors: {},
        limits: LIMITS,
        done: { withdrawal, outcome },
      });
    } catch (err) {
      next(err);
    }
  });
}
