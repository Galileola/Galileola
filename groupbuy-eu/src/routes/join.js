import { JoinError } from '../engine.js';
import { isJoinable, publicDealState } from '../dealState.js';
import { EU_COUNTRIES, isValidEmail } from '../util.js';
import { createRateLimiter } from '../rateLimit.js';

export function validateJoinInput(body) {
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
  if (!isValidEmail(input.email)) errors.email = 'Enter a valid email address.';
  if (!input.name) errors.name = 'Enter your full name.';
  if (!input.address_line1) errors.address_line1 = 'Enter your street and number.';
  if (!input.postal_code) errors.postal_code = 'Enter your postcode.';
  if (!input.city) errors.city = 'Enter your city.';
  if (!EU_COUNTRIES[input.country]) errors.country = 'We currently deliver to EU countries only.';
  if (body.accept_terms !== 'yes') errors.accept_terms = 'Please accept the terms to join.';
  return { input, errors };
}

export function joinRoutes(app, ctx) {
  const { repo, engine, stripe, clock, config } = ctx;
  // Each join creates a Stripe Customer, a tax calculation and a SetupIntent: limit per IP.
  const joinLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: config.joinRateLimit ?? 10, clock });

  const renderDeal = (res, deal, values, errors, status = 422) =>
    res.status(status).render('deal', {
      title: deal.product_name,
      deal,
      state: publicDealState(deal, repo.committedCount(deal.id), clock.now()),
      values,
      errors,
    });

  app.post('/deals/:slug/join', async (req, res, next) => {
    const deal = repo.dealBySlug(req.params.slug);
    if (!deal) return next();
    if (!joinLimiter.take(req.ip)) {
      return renderDeal(res, deal, req.body, { form: 'Too many attempts from your network. Please wait 15 minutes and try again.' }, 429);
    }
    const { input, errors } = validateJoinInput(req.body);
    if (Object.keys(errors).length) return renderDeal(res, deal, req.body, errors);
    try {
      const p = await engine.startJoin(deal, input);
      res.redirect(303, `/join/${p.token}`);
    } catch (err) {
      if (err instanceof JoinError) return renderDeal(res, deal, req.body, { form: err.message });
      next(err);
    }
  });

  // Payment details page (Stripe Payment Element on the SetupIntent).
  app.get('/join/:token', async (req, res, next) => {
    try {
      const p = repo.participantByToken(req.params.token);
      if (!p) return next();
      if (p.status !== 'pending_setup') return res.redirect(303, `/join/${p.token}/done`);
      const deal = repo.dealById(p.deal_id);
      if (!isJoinable(deal, clock.now())) {
        return res.render('message', { title: 'Deal closed', heading: 'This deal is closed', body: 'It is no longer possible to join. You have not been charged.' });
      }
      const si = await stripe.setupIntents.retrieve(p.setup_intent_id);
      res.set('Cache-Control', 'no-store');
      res.render('join', {
        title: `Join: ${deal.product_name}`,
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
    const deal = repo.dealById(p.deal_id);
    res.set('Cache-Control', 'no-store');
    res.render('join-done', {
      title: deal.product_name,
      deal,
      p,
      state: publicDealState(deal, repo.committedCount(deal.id), clock.now()),
    });
  });
}
