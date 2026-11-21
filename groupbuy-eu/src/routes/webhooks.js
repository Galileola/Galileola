import express from 'express';

export function webhookRoutes(app, { config, repo, stripe, engine, clock }) {
  app.post('/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.stripeWebhookSecret);
    } catch (err) {
      return res.status(400).send('Webhook signature verification failed.');
    }
    // Events from the other Stripe mode (a test webhook while live, or the reverse) are refused.
    if (Boolean(event.livemode) !== (config.paymentsMode === 'live')) {
      return res.status(400).send(`${event.livemode ? 'Live' : 'Test'}-mode events are not accepted in ${config.paymentsMode === 'live' ? 'live' : 'test'} mode.`);
    }
    if (!repo.recordEvent(event.id, event.type, clock.now().toISOString())) {
      return res.json({ received: true, duplicate: true });
    }
    try {
      await engine.handleEvent(event);
      res.json({ received: true });
    } catch (err) {
      repo.forgetEvent(event.id); // let Stripe retry
      console.error(`[webhook] ${event.type} ${event.id} failed:`, err);
      res.status(500).send('Webhook handler failed.');
    }
  });
}
