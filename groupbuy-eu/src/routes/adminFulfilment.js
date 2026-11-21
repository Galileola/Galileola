import { SHIPPABLE, markShipped, messageBuyers, parseTrackingLines, validateMessage } from '../fulfilment.js';

// Admin → deal page: shipping (one order or many) and messages to the deal's buyers.
export function fulfilmentRoutes(router, ctx) {
  const { repo, clock } = ctx;
  const back = (res, dealId, flash, anchor = '') =>
    res.redirect(303, `/admin/deals/${dealId}?flash=${encodeURIComponent(flash)}${anchor}`);

  router.post('/participants/:id/ship', async (req, res, next) => {
    try {
      const p = repo.participantById(Number(req.params.id));
      if (!p) return next();
      const error = await markShipped(ctx, p, { tracking: req.body.tracking, url: req.body.url });
      back(res, p.deal_id, error || `Order #${p.id} marked as shipped; ${p.email} has been emailed.`, '#buyers');
    } catch (err) {
      next(err);
    }
  });

  // Undo a mistaken "shipped" (no email is sent).
  router.post('/participants/:id/unship', (req, res, next) => {
    const p = repo.participantById(Number(req.params.id));
    if (!p) return next();
    repo.updateParticipant(p.id, { shipped_at: null, tracking_number: '', tracking_url: '' }, clock.now().toISOString());
    back(res, p.deal_id, `Order #${p.id} is no longer marked as shipped.`, '#buyers');
  });

  router.post('/deals/:id/ship-bulk', async (req, res, next) => {
    try {
      const deal = repo.dealById(Number(req.params.id));
      if (!deal) return next();
      const orders = repo.participantsForDeal(deal.id, SHIPPABLE);
      let shipped = 0;
      const problems = [];
      if (req.body.all === '1') {
        for (const p of orders.filter((o) => !o.shipped_at)) {
          if (!(await markShipped(ctx, p))) shipped += 1;
        }
      } else {
        const { rows, errors } = parseTrackingLines(req.body.lines);
        problems.push(...errors);
        for (const row of rows) {
          const p = orders.find((o) => o.id === row.id);
          if (!p) {
            problems.push(`#${row.id} is not a paid order of this deal.`);
            continue;
          }
          const error = await markShipped(ctx, p, { tracking: row.tracking, url: row.url });
          if (error) problems.push(`#${row.id}: ${error}`);
          else shipped += 1;
        }
      }
      const summary = shipped ? `${shipped} order${shipped === 1 ? '' : 's'} marked as shipped and emailed.` : 'No orders were marked as shipped.';
      back(res, deal.id, problems.length ? `${summary} ${problems.slice(0, 5).join(' ')}${problems.length > 5 ? ' …' : ''}` : summary, '#shipping');
    } catch (err) {
      next(err);
    }
  });

  router.post('/deals/:id/message', async (req, res, next) => {
    try {
      const deal = repo.dealById(Number(req.params.id));
      if (!deal) return next();
      const { errors, message, audience } = validateMessage(req.body);
      if (Object.keys(errors).length) return back(res, deal.id, Object.values(errors).join(' '), '#message');
      const sent = await messageBuyers(ctx, deal, { ...message, audience });
      back(res, deal.id, sent ? `Message sent to ${sent} buyer${sent === 1 ? '' : 's'}.` : 'Nobody to send it to yet.', '#message');
    } catch (err) {
      next(err);
    }
  });
}
