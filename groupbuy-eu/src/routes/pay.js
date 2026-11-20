// The link in the "payment failed" / "confirm your payment" emails.
export function payRoutes(app, ctx) {
  const { repo, engine, stripe, clock, config } = ctx;

  const closed = (res, heading, body) => res.render('message', { title: heading, heading, body });

  app.get('/pay/:token', async (req, res, next) => {
    try {
      const p = repo.participantByToken(req.params.token);
      if (!p) return next();
      const { t } = res.locals;
      const deal = res.locals.localizeDeal(repo.dealById(p.deal_id));
      res.set('Cache-Control', 'no-store');
      if (p.status === 'paid' || p.status === 'processing') return res.redirect(303, `/join/${p.token}/done`);
      if (['unpaid', 'late_failed'].includes(p.status) || (p.grace_ends_at && clock.now() >= new Date(p.grace_ends_at))) {
        return closed(res, t('pay.closedTitle'), t('pay.closedBody'));
      }
      if (p.status !== 'failed' || !p.payment_intent_id) {
        if (['saved', 'charging'].includes(p.status) && deal.status !== 'open') {
          return closed(res, t('pay.inProgressTitle'), t('pay.inProgressBody'));
        }
        return res.redirect(303, `/join/${p.token}/done`);
      }

      let pi = await stripe.paymentIntents.retrieve(p.payment_intent_id);
      if (['succeeded', 'processing'].includes(pi.status)) {
        await engine.applyPaymentIntent(pi);
        return res.redirect(303, `/join/${p.token}/done`);
      }
      if (pi.status === 'canceled') return closed(res, t('pay.closedTitle'), t('pay.canceledBody'));

      res.render('pay', {
        title: t('pay.pageTitle', { name: deal.product_name }),
        loadStripe: true,
        deal,
        p,
        clientSecret: pi.client_secret,
        publishableKey: config.stripePublishableKey,
        returnUrl: `${config.baseUrl}/pay/${p.token}/complete`,
        canReuseSavedCard: p.payment_method_type === 'card' && !!p.payment_method_id,
        error: req.query.error === '1',
      });
    } catch (err) {
      next(err);
    }
  });

  // Stripe returns here after on-session confirmation (3-D Secure, new card, or SEPA).
  app.get('/pay/:token/complete', async (req, res, next) => {
    try {
      const p = repo.participantByToken(req.params.token);
      if (!p || !p.payment_intent_id) return next();
      const pi = await stripe.paymentIntents.retrieve(p.payment_intent_id);
      const updated = await engine.applyPaymentIntent(pi);
      if (['paid', 'processing'].includes(updated.status)) return res.redirect(303, `/join/${p.token}/done`);
      res.redirect(303, `/pay/${p.token}?error=1`);
    } catch (err) {
      next(err);
    }
  });
}
