import { createRateLimiter } from '../rateLimit.js';
import { announceDeal, confirm, subscribe, unsubscribe } from '../alerts.js';
import { csvCell } from './admin.js';

// Deal alerts (src/alerts.js): the sign-up form on the home page, the confirm and unsubscribe
// links, and (adminAlertRoutes) the subscriber list and "email this deal" in the admin.
export function alertRoutes(app, ctx) {
  const { clock } = ctx;
  const limiter = createRateLimiter({ windowMs: 15 * 60_000, max: 5, clock });
  const message = (res, status, { emoji, heading, body, link }) =>
    res.status(status).render('message', { title: heading, emoji, heading, body, link });

  app.post('/alerts', async (req, res, next) => {
    try {
      const { t, lang } = res.locals;
      const back = { href: '/#alerts', label: t('errors.backToDeals') };
      // Bots fill in every field; people don't see this one.
      if (req.body.website) return message(res, 200, { emoji: '📬', heading: t('alerts.checkTitle'), body: t('alerts.checkText') });
      if (!limiter.take(req.ip)) return message(res, 429, { emoji: '⏳', heading: t('alerts.tooMany'), body: '', link: back });
      const result = await subscribe(ctx, { email: req.body.email, lang });
      if (result === 'invalid') return message(res, 422, { emoji: '✉️', heading: t('alerts.invalidEmail'), body: '', link: back });
      message(res, 200, { emoji: '📬', heading: t('alerts.checkTitle'), body: t('alerts.checkText') });
    } catch (err) {
      next(err);
    }
  });

  app.get('/alerts/confirm/:token', (req, res) => {
    const { t } = res.locals;
    const sub = confirm(ctx, req.params.token);
    if (!sub) return message(res, 404, { emoji: '🔗', heading: t('alerts.linkInvalid'), body: '', link: { href: '/#alerts', label: t('errors.backToDeals') } });
    message(res, 200, { emoji: '🎉', heading: t('alerts.confirmedTitle'), body: t('alerts.confirmedText'), link: { href: '/#deals', label: t('home.seeAll') } });
  });

  // The link in every alert shows a button (so link scanners in mail apps can't unsubscribe
  // people); mail apps' own one-click unsubscribe POSTs straight here (RFC 8058).
  app.get('/alerts/unsubscribe/:token', (req, res) => {
    const { t } = res.locals;
    const sub = ctx.repo.subscriberByToken(req.params.token);
    if (!sub) return message(res, 404, { emoji: '🔗', heading: t('alerts.linkInvalid'), body: '' });
    res.render('alerts-unsubscribe', { title: t('alerts.unsubscribeTitle'), token: req.params.token, done: sub.status === 'unsubscribed' });
  });

  app.post('/alerts/unsubscribe/:token', (req, res) => {
    const { t } = res.locals;
    const sub = unsubscribe(ctx, req.params.token);
    if (!sub) return message(res, 404, { emoji: '🔗', heading: t('alerts.linkInvalid'), body: '' });
    message(res, 200, { emoji: '👋', heading: t('alerts.unsubscribedTitle'), body: t('alerts.unsubscribedText'), link: { href: '/', label: t('errors.backToDeals') } });
  });
}

export function adminAlertRoutes(router, ctx) {
  const { repo } = ctx;

  router.post('/deals/:id/announce', async (req, res, next) => {
    try {
      const deal = repo.dealById(Number(req.params.id));
      if (!deal) return next();
      if (deal.status !== 'open') return res.redirect(303, `/admin/deals/${deal.id}?flash=${encodeURIComponent('Only open deals can be announced.')}`);
      const n = await announceDeal(ctx, deal);
      const flash = n ? `Emailed to ${n} subscriber${n === 1 ? '' : 's'}.` : 'Nobody has subscribed to deal alerts yet.';
      res.redirect(303, `/admin/deals/${deal.id}?flash=${encodeURIComponent(flash)}`);
    } catch (err) {
      next(err);
    }
  });

  router.get('/subscribers', (req, res) => {
    res.render('admin/subscribers', {
      title: 'Deal alert subscribers',
      subscribers: repo.subscribers(),
      counts: repo.subscriberCounts(),
      flash: req.query.flash || '',
    });
  });

  router.get('/subscribers.csv', (req, res) => {
    const lines = [
      ['email', 'language', 'status', 'signed_up', 'confirmed', 'unsubscribed'],
      ...repo.subscribers().map((s) => [s.email, s.lang, s.status, s.created_at, s.confirmed_at ?? '', s.unsubscribed_at ?? '']),
    ].map((cols) => cols.map(csvCell).join(','));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="deal-alert-subscribers.csv"');
    res.send('﻿' + lines.join('\r\n') + '\r\n');
  });

  router.post('/subscribers/:id/delete', (req, res) => {
    repo.deleteSubscriber(Number(req.params.id));
    res.redirect(303, `/admin/subscribers?flash=${encodeURIComponent('Subscriber removed.')}`);
  });
}
