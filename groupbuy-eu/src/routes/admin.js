import express from 'express';
import multer from 'multer';
import { HttpError } from '../app.js';
import { validateDealInput } from '../deals.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hmac, safeEqual, randomToken } from '../util.js';
import { MAX_PHOTO_BYTES, MAX_PHOTOS_PER_DEAL, PHOTO_ACCEPT, checkPhotos, uploadErrorMessage } from '../photos.js';
import {
  DESCRIPTION_SCHEMA,
  DescribeInputError,
  describeMessages,
  describeSystemPrompt,
  validateDescribeInput,
} from '../describe.js';
import { createRateLimiter } from '../rateLimit.js';

// Photo uploads are parsed into memory (admin only, at most 8 × 8 MB per request), checked,
// and only then written to UPLOAD_DIR.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS_PER_DEAL, fields: 40, fieldSize: 64 * 1024, parts: 60 },
});
const parsePhotos = (req, res, next) =>
  upload.array('photos', MAX_PHOTOS_PER_DEAL)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      req.photoError = uploadErrorMessage(err);
      req.files = [];
      return next();
    }
    next(err);
  });

export function requireAdmin(config) {
  return (req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      const user = decoded.slice(0, i);
      const pass = decoded.slice(i + 1);
      const okUser = safeEqual(user, config.adminUser);
      const okPass = safeEqual(pass, config.adminPassword);
      if (i > 0 && okUser && okPass) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Group Buy admin", charset="UTF-8"');
    res.status(401).send('Authentication required');
  };
}

export function adminRoutes(app, ctx) {
  const { config, repo, clock } = ctx;
  const router = express.Router();
  const csrfToken = hmac(config.appSecret, 'admin-csrf');

  router.use(requireAdmin(config));
  // Multipart forms (with photos) are parsed before the form-token check, which reads req.body.
  // The token field comes first in those forms, so it is read even if a photo is too large.
  router.post(['/deals', '/deals/:id/photos'], parsePhotos);
  // Same for the JSON body of "Write with AI" (photos are downscaled in the browser first).
  router.post('/ai/description', express.json({ limit: '12mb' }));
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.locals.csrfToken = csrfToken;
    res.locals.assistantEnabled = false;
    res.locals.aiWritingEnabled = Boolean(ctx.assistant);
    res.locals.photoAccept = PHOTO_ACCEPT;
    res.locals.maxPhotos = MAX_PHOTOS_PER_DEAL;
    if (req.method === 'POST' && !safeEqual(req.body?._csrf ?? '', csrfToken)) {
      return next(new HttpError(403, 'Invalid form token. Reload the page and try again.'));
    }
    next();
  });

  router.get('/', (req, res) => {
    const deals = repo
      .listDeals()
      .map((d) => ({ ...d, count: repo.committedCount(d.id), cover: repo.coverPhoto(d.id) }));
    res.render('admin/index', { title: 'Admin', deals });
  });

  router.get('/deals/new', (req, res) => {
    res.render('admin/new', { title: 'New deal', values: { tax_code: config.defaultTaxCode }, errors: {} });
  });

  router.post('/deals', (req, res) => {
    const { errors, deal } = validateDealInput(req.body, { now: clock.now(), defaultTaxCode: config.defaultTaxCode });
    const photoError = req.photoError || checkPhotos(req.files);
    if (photoError) errors.photos = `${photoError} Please choose the photos again.`;
    if (!deal || photoError) return res.status(422).render('admin/new', { title: 'New deal', values: req.body, errors });
    const created = repo.insertDeal(deal);
    savePhotos(created.id, req.files);
    res.redirect(303, `/admin/deals/${created.id}`);
  });

  // Drafts a product description with Claude. Nothing is saved: the draft goes into the form.
  const describeLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: 30, clock });
  router.post('/ai/description', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!ctx.assistant) {
      return res.status(503).json({ error: 'AI writing is off. Add ANTHROPIC_API_KEY to the environment variables.' });
    }
    let input;
    try {
      input = validateDescribeInput(req.body);
    } catch (err) {
      if (err instanceof DescribeInputError) return res.status(400).json({ error: err.message });
      throw err;
    }
    if (!describeLimiter.take(req.ip)) {
      return res.status(429).json({ error: 'Too many drafts in a short time. Please wait a few minutes.' });
    }
    try {
      const result = await ctx.assistant.reply({
        system: describeSystemPrompt(config.business),
        messages: describeMessages(input),
        effort: 'medium',
        maxTokens: 8000,
        format: DESCRIPTION_SCHEMA,
      });
      const description = result.refused ? '' : String(JSON.parse(result.text).description ?? '').trim();
      if (!description) return res.status(422).json({ error: "The AI couldn't write a description for this product. Please write it yourself." });
      res.json({ description: description.slice(0, 5000) });
    } catch (err) {
      console.error('[ai-description]', err?.status ?? '', err?.message ?? err);
      res.status(502).json({ error: 'The AI could not write a description just now. Please try again.' });
    }
  });

  const savePhotos = (dealId, files) => {
    const now = clock.now().toISOString();
    for (const f of files ?? []) repo.addPhoto(dealId, ctx.photos.save(f.buffer), now);
  };
  const backToDeal = (res, dealId, flash) =>
    res.redirect(303, `/admin/deals/${dealId}?flash=${encodeURIComponent(flash)}`);

  router.post('/deals/:id/photos', (req, res, next) => {
    const deal = repo.dealById(Number(req.params.id));
    if (!deal) return next();
    const files = req.files ?? [];
    const error = req.photoError || checkPhotos(files);
    if (error) return backToDeal(res, deal.id, error);
    if (!files.length) return backToDeal(res, deal.id, 'Choose one or more photos first.');
    const room = MAX_PHOTOS_PER_DEAL - repo.photosForDeal(deal.id).length;
    if (files.length > room) {
      return backToDeal(res, deal.id, `A deal can have up to ${MAX_PHOTOS_PER_DEAL} photos. You can add ${Math.max(0, room)} more.`);
    }
    savePhotos(deal.id, files);
    backToDeal(res, deal.id, files.length === 1 ? 'Photo added.' : `${files.length} photos added.`);
  });

  router.post('/photos/:id/cover', (req, res, next) => {
    const photo = repo.photoById(Number(req.params.id));
    if (!photo) return next();
    repo.makeCoverPhoto(photo.id);
    backToDeal(res, photo.deal_id, 'Cover photo changed.');
  });

  router.post('/photos/:id/delete', (req, res, next) => {
    const photo = repo.photoById(Number(req.params.id));
    if (!photo) return next();
    repo.deletePhoto(photo.id);
    ctx.photos.remove(photo.filename);
    backToDeal(res, photo.deal_id, 'Photo deleted.');
  });

  router.get('/deals/:id', (req, res, next) => {
    const deal = repo.dealById(Number(req.params.id));
    if (!deal) return next();
    const participants = repo.participantsForDeal(deal.id);
    const counts = repo.statusCounts(deal.id);
    res.render('admin/deal', {
      title: deal.product_name,
      deal,
      photos: repo.photosForDeal(deal.id),
      participants,
      counts,
      committed: repo.committedCount(deal.id),
      summary: summarize(participants),
      flash: req.query.flash || '',
      testTools: true, // Stripe test mode only (enforced at startup)
    });
  });

  // Order list for placing the supplier order and shipping: everyone who paid (SEPA still
  // processing counts as paid), with delivery address and VAT per country.
  router.get('/deals/:id/orders.csv', (req, res, next) => {
    const deal = repo.dealById(Number(req.params.id));
    if (!deal) return next();
    const rows = repo.participantsForDeal(deal.id, ['paid', 'processing']);
    const header = ['participant_id', 'status', 'name', 'email', 'address_line1', 'address_line2', 'postal_code', 'city', 'country',
      'amount_eur', 'vat_eur', 'vat_rate', 'payment_method', 'paid_at', 'stripe_payment_intent'];
    const eur = (c) => (c == null ? '' : (c / 100).toFixed(2));
    const lines = [header, ...rows.map((p) => [
      p.id, p.status, p.name, p.email, p.address_line1, p.address_line2, p.postal_code, p.city, p.country,
      eur(p.amount_cents), eur(p.tax_cents), p.tax_rate_label, p.payment_method_label, p.paid_at ?? '', p.payment_intent_id,
    ])].map((cols) => cols.map(csvCell).join(','));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="order-${deal.slug}.csv"`);
    res.send('\ufeff' + lines.join('\r\n') + '\r\n'); // BOM so Excel reads UTF-8 (ä, ß, é…)
  });

  // Off-site backup: a consistent copy of the live database, streamed to the admin's browser.
  router.get('/backup.sqlite', (req, res, next) => {
    const tmp = path.join(os.tmpdir(), `groupbuy-backup-${randomToken(8)}.sqlite`);
    try {
      repo.db.prepare('VACUUM INTO ?').run(tmp);
    } catch (err) {
      return next(err);
    }
    const stamp = clock.now().toISOString().slice(0, 10);
    res.download(tmp, `groupbuy-${stamp}.sqlite`, () => fs.rm(tmp, { force: true }, () => {}));
  });

  router.get('/emails', (req, res) => {
    res.render('admin/emails', { title: 'Email outbox', emails: repo.listEmails() });
  });

  // ---- Test-mode tools: move time forward for one deal so the checklist can be run in minutes.
  const testAction = (pathName, fn) =>
    router.post(`/deals/:id/test/${pathName}`, async (req, res, next) => {
      try {
        const deal = repo.dealById(Number(req.params.id));
        if (!deal) return next();
        const flash = await fn(deal);
        await ctx.engine.tick();
        res.redirect(303, `/admin/deals/${deal.id}?flash=${encodeURIComponent(flash)}`);
      } catch (err) {
        next(err);
      }
    });

  testAction('expire-now', async (deal) => {
    if (deal.status !== 'open') return 'Only open deals have a deadline to move.';
    repo.updateDeal(deal.id, { deadline: new Date(clock.now().getTime() - 1000).toISOString() });
    return 'Deadline moved to now and the scheduler ran.';
  });

  testAction('retry-now', async (deal) => {
    const due = repo.participantsForDeal(deal.id, ['failed']).filter((p) => p.next_retry_at);
    for (const p of due) repo.updateParticipant(p.id, { next_retry_at: clock.now().toISOString() }, clock.now().toISOString());
    return due.length ? `Retried ${due.length} failed card charge(s).` : 'No automatic retries are scheduled (SCA and SEPA failures wait for the buyer).';
  });

  testAction('end-window-now', async (deal) => {
    if (deal.status !== 'charging') return 'The 48-hour window only exists while a deal is charging.';
    const past = new Date(clock.now().getTime() - 1000).toISOString();
    repo.updateDeal(deal.id, { grace_ends_at: past });
    for (const p of repo.participantsForDeal(deal.id)) {
      if (p.grace_ends_at) repo.updateParticipant(p.id, { grace_ends_at: past }, clock.now().toISOString());
    }
    return 'Payment window ended and the scheduler ran.';
  });

  router.post('/participants/:id/withdraw', async (req, res, next) => {
    const p = repo.participantById(Number(req.params.id));
    if (!p) return next();
    let flash;
    try {
      const updated = await ctx.engine.withdraw(p.id);
      flash = updated.refund_id ? `Refunded ${p.email} and reversed the VAT record.` : `Released ${p.email}; nothing was charged.`;
    } catch (err) {
      flash = `Withdrawal not processed: ${err.message}`;
    }
    res.redirect(303, `/admin/deals/${p.deal_id}?flash=${encodeURIComponent(flash)}`);
  });

  router.post('/tick', async (req, res, next) => {
    try {
      await ctx.engine.tick();
      res.redirect(303, req.body.back?.startsWith('/admin') ? req.body.back : '/admin');
    } catch (err) {
      next(err);
    }
  });

  for (const extend of ctx.adminExtensions ?? []) extend(router, ctx);

  app.use('/admin', router);
}

// CSV cell: quote everything; neutralise spreadsheet formulas (=, +, -, @) from buyer input.
export function csvCell(value) {
  let v = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

// Money summary for the admin: what was collected and what is your cost.
export function summarize(participants) {
  const sum = (list) => list.reduce((acc, p) => acc + (p.amount_cents || 0), 0);
  const by = (...statuses) => participants.filter((p) => statuses.includes(p.status));
  const paid = by('paid');
  const processing = by('processing');
  const failed = by('failed', 'charging');
  const unpaid = by('unpaid', 'late_failed');
  return {
    paidCount: paid.length,
    paidCents: sum(paid),
    processingCount: processing.length,
    processingCents: sum(processing),
    openFailures: failed.length,
    openFailuresCents: sum(failed),
    yourCostCount: unpaid.length,
    yourCostCents: sum(unpaid),
    vatCents: paid.concat(processing).reduce((acc, p) => acc + (p.tax_cents || 0), 0),
    orderQuantity: paid.length + processing.length,
  };
}
