import { JoinError } from '../engine.js';
import { isJoinable, publicDealState } from '../dealState.js';
import { EU_COUNTRIES, isValidEmail } from '../util.js';
import { createRateLimiter } from '../rateLimit.js';
import { isLanguage, translate } from '../i18n/index.js';
import { applyLanguage } from '../i18n/middleware.js';

const english = (key) => translate('en', key);

// `t` translates the error messages (English by default).
export function validateJoinInput(body, t = english) {
  const v = (k, max = 200) => String(body[k] ?? '').trim().slice(0, max);
  const input = {
    email: v('email', 254).toLowerCase(),
    name: v('name', 120),
    address_line1: v('address_line1'),
    address_line2: v('address_line2'),
    postal_code: v('postal_code', 20),
    city: v('city', 100),
    country: v('country', 2).toUpperCase(),
  };
  const errors = {};
  if (!isValidEmail(input.email)) errors.email = t('join.errEmail');
  if (!input.name) errors.name = t('join.errName');
  if (!input.address_line1) errors.address_line1 = t('join.errStreet');
  if (!input.postal_code) errors.postal_code = t('join.errPostcode');
  if (!input.city) errors.city = t('join.errCity');
  if (!EU_COUNTRIES[input.country]) errors.country = t('join.errCountry');
  if (body.accept_terms !== 'yes') errors.accept_terms = t('join.errTerms');
  return { input, errors };
}

export function joinRoutes(app, ctx) {
  const { repo, engine, stripe, clock, config } = ctx;
  // Each join creates a Stripe Customer, a tax calculation and a SetupIntent: limit per IP.
  const joinLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: config.joinRateLimit ?? 10, clock });

  const renderDeal = (res, deal, values, errors, status = 422) => {
    const shown = res.locals.localizeDeal(deal);
    res.locals.canonicalPath = `/deals/${deal.slug}`;
    res.status(status).render('deal', {
      title: shown.product_name,
      deal: shown,
      photos: repo.photosForDeal(deal.id),
      state: publicDealState(deal, repo.committedCount(deal.id), clock.now()),
      values,
      errors,
    });
  };

  const JOIN_ERRORS = { closed: 'join.errClosed', already_joined: 'join.errAlreadyJoined', vat: 'join.errVat' };

  app.post('/deals/:slug/join', async (req, res, next) => {
    const deal = repo.dealBySlug(req.params.slug);
    if (!deal) return next();
    // The form says which language the page was in (the visitor may have no language cookie).
    if (isLanguage(req.body.lang) && req.body.lang !== res.locals.lang) applyLanguage(req, res, req.body.lang, ctx);
    const { t, lang } = res.locals;
    if (!joinLimiter.take(req.ip)) {
      return renderDeal(res, deal, req.body, { form: t('join.errTooMany') }, 429);
    }
    const { input, errors } = validateJoinInput(req.body, t);
    if (Object.keys(errors).length) return renderDeal(res, deal, req.body, errors);
    try {
      const p = await engine.startJoin(deal, { ...input, lang });
      // Which ad, post or website brought this buyer (Admin → Performance).
      try {
        if (ctx.analytics) repo.setParticipantSource(p.id, ctx.analytics.sourceOf(req));
      } catch (err) {
        console.warn(`[analytics] could not save the buyer's source: ${err.message}`);
      }
      res.redirect(303, `/join/${p.token}`);
    } catch (err) {
      if (err instanceof JoinError) {
        return renderDeal(res, deal, req.body, { form: JOIN_ERRORS[err.code] ? t(JOIN_ERRORS[err.code]) : err.message });
      }
      next(err);
    }
  });

  // Payment details page (Stripe Payment Element on the SetupIntent).
  app.get('/join/:token', async (req, res, next) => {
    try {
      const p = repo.participantByToken(req.params.token);
      if (!p) return next();
      if (p.status !== 'pending_setup') return res.redirect(303, `/join/${p.token}/done`);
      const { t, localizeDeal } = res.locals;
      const found = repo.dealById(p.deal_id);
      if (!isJoinable(found, clock.now())) {
        return res.render('message', { title: t('join.closedTitle'), heading: t('join.closedHeading'), body: t('join.closedBody') });
      }
      const deal = localizeDeal(found);
      const si = await stripe.setupIntents.retrieve(p.setup_intent_id);
      res.set('Cache-Control', 'no-store');
      res.render('join', {
        title: t('setup.pageTitle', { name: deal.product_name }),
        loadStripe: true,
        deal,
        p,
        clientSecret: si.client_secret,
        publishableKey: config.stripePublishableKey,
        returnUrl: `${config.baseUrl}/join/${p.token}/complete`,
        failed: req.query.failed === '1',
      });
    } catch (err) {
      next(err);
    }
  });

  // Stripe redirects here after confirmSetup (immediately for cards/SEPA, after the bank for iDEAL).
  app.get('/join/:token/complete', async (req, res, next) => {
    try {
      const p = repo.participantByToken(req.params.token);
      if (!p) return next();
      const { p: updated, si } = await engine.finalizeSetupIntent(p.setup_intent_id);
      if (si.status === 'requires_payment_method') return res.redirect(303, `/join/${p.token}?failed=1`);
      res.redirect(303, `/join/${updated.token}/done`);
    } catch (err) {
      next(err);
    }
  });

  app.get('/join/:token/done', (req, res, next) => {
    const p = repo.participantByToken(req.params.token);
    if (!p) return next();
    const deal = res.locals.localizeDeal(repo.dealById(p.deal_id));
    res.set('Cache-Control', 'no-store');
    res.render('join-done', {
      title: deal.product_name,
      deal,
      p,
      state: publicDealState(deal, repo.committedCount(deal.id), clock.now()),
    });
  });
}
