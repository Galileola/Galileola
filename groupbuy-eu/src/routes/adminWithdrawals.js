import { refundWithdrawal } from '../withdrawals.js';

// Admin → Withdrawals: what buyers sent with "Withdraw from contract here" (src/withdrawals.js).
// Orders that hadn't been charged were cancelled automatically; the rest wait here.
export function withdrawalRoutes(router, ctx) {
  const { repo, clock } = ctx;
  const back = (res, flash) => res.redirect(303, `/admin/withdrawals?flash=${encodeURIComponent(flash)}`);

  router.get('/withdrawals', (req, res) => {
    res.render('admin/withdrawals', { title: 'Withdrawals', withdrawals: repo.withdrawals(), flash: req.query.flash || '' });
  });

  // Refunds a paid order in full (or cancels one that hasn't been charged).
  router.post('/withdrawals/:id/refund', async (req, res, next) => {
    const w = repo.withdrawalById(Number(req.params.id));
    if (!w) return next();
    try {
      const p = await refundWithdrawal(ctx, w);
      back(res, p.refund_id ? `${w.reference}: refunded in full; the buyer has been emailed.` : `${w.reference}: cancelled, nothing had been charged.`);
    } catch (err) {
      back(res, `${w.reference}: not processed. ${err.message}`);
    }
  });

  router.post('/withdrawals/:id/done', (req, res, next) => {
    const w = repo.withdrawalById(Number(req.params.id));
    if (!w) return next();
    const note = String(req.body.note ?? '').trim().slice(0, 300);
    repo.updateWithdrawal(w.id, { status: 'done', handled_at: clock.now().toISOString(), ...(note ? { note } : {}) });
    back(res, `${w.reference}: marked as handled.`);
  });
}
