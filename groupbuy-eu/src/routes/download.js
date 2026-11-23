import { createRateLimiter } from '../rateLimit.js';
import { canDownload, describeFiles, isDigital } from '../digital.js';

// A buyer's downloads (src/digital.js): /download/<token> lists the files of their order, and
// /download/<token>/<file id> sends one. The token is the buyer's secret (the same one as their
// order page); the files are only sent while the order is paid. They are never cached by the
// browser or a proxy, and always saved as a file, never opened as a page of this site.
export function downloadRoutes(app, ctx) {
  const { repo, clock } = ctx;
  // Per order: enough for a buyer on several devices, not for a link shared with the world.
  const limiter = createRateLimiter({ windowMs: 15 * 60_000, max: ctx.config.downloadRateLimit ?? 30, clock });

  const orderOf = (token) => {
    if (!/^[\w-]{20,100}$/.test(String(token ?? ''))) return null;
    const p = repo.participantByToken(token);
    if (!p || p.erased_at) return null;
    const deal = repo.dealById(p.deal_id);
    return isDigital(deal) ? { p, deal } : null;
  };

  app.get('/download/:token', (req, res, next) => {
    const order = orderOf(req.params.token);
    if (!order) return next();
    const { p } = order;
    const { t, localizeDeal, lang } = res.locals;
    const deal = localizeDeal(order.deal);
    res.set('Cache-Control', 'no-store');
    const ok = canDownload(p, order.deal);
    // Withdrawn or refunded orders: the files are gone; anything else is still on its way.
    const ended = ['withdrawn', 'released', 'unpaid', 'late_failed'].includes(p.status) || Boolean(p.refund_id);
    res.render('download', {
      title: t('download.title'),
      deal,
      p,
      files: ok ? describeFiles(repo.filesForDeal(order.deal.id), lang) : [],
      ok,
      ended,
    });
  });

  app.get('/download/:token/:fileId', (req, res, next) => {
    const order = orderOf(req.params.token);
    if (!order) return next();
    const { p, deal } = order;
    const file = repo.fileById(Number(req.params.fileId));
    if (!file || file.deal_id !== deal.id) return next();
    res.set('Cache-Control', 'private, no-store');
    if (!canDownload(p, deal)) return res.redirect(303, `/download/${p.token}`);
    const { t } = res.locals;
    const path = ctx.files?.pathOf(file.filename);
    if (!path || !ctx.files.exists(file.filename)) {
      console.error(`[download] file ${file.filename} of deal ${deal.id} is missing from FILES_DIR`);
      return next();
    }
    // A download manager asking for the rest of a file doesn't count as another download.
    const range = String(req.headers.range ?? '');
    const fresh = !range || /^bytes=0-/.test(range);
    if (fresh && !limiter.take(p.token)) {
      return res.status(429).render('message', { title: t('download.title'), heading: t('download.title'), body: t('join.errTooMany') });
    }
    if (fresh) repo.recordDownload(p.id, clock.now().toISOString());
    res.download(path, file.original_name, {
      headers: {
        'Content-Type': file.content_type,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Robots-Tag': 'noindex, nofollow',
      },
    }, (err) => {
      if (err && !res.headersSent) next(err);
    });
  });
}
