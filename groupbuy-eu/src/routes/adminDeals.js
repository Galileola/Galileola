import { validateDealEdit } from '../deals.js';

// Admin → deal page: edit, cancel, delete and duplicate a deal.

// The datetime-local value for a date (UTC; the browser script converts it to local time).
const isoMinutes = (d) => new Date(d).toISOString().slice(0, 16);

export function dealToFormValues(deal) {
  return {
    product_name: deal.product_name,
    headline: deal.headline,
    description: deal.description,
    social_post: deal.social_post,
    image_url: deal.image_url,
    category: deal.category,
    seo_title: deal.seo_title,
    seo_description: deal.seo_description,
    price: (deal.price_cents / 100).toFixed(2),
    min_buyers: String(deal.min_buyers),
    tax_code: deal.tax_code,
    deadline_iso: deal.deadline,
  };
}

// Copies the photo files of one deal to another (used when duplicating a deal).
export function copyPhotos(ctx, fromDealId, toDealId) {
  const now = ctx.clock.now().toISOString();
  let copied = 0;
  for (const ph of ctx.repo.photosForDeal(fromDealId)) {
    try {
      const files = ctx.photos.duplicate(ph);
      ctx.repo.addPhoto(toDealId, { ...files, width: ph.width, height: ph.height }, now, { alt: ph.alt ?? '' });
      copied += 1;
    } catch (err) {
      console.warn(`[duplicate] photo ${ph.filename} not copied: ${err.message}`);
    }
  }
  return copied;
}

export function dealRoutes(router, ctx) {
  const { repo, clock } = ctx;
  const backToDeal = (res, id, flash) => res.redirect(303, `/admin/deals/${id}?flash=${encodeURIComponent(flash)}`);
  const joinedCount = (dealId) => repo.participantsForDeal(dealId).filter((p) => !['released', 'withdrawn'].includes(p.status)).length;

  const editPage = (res, status, deal, values, errors = {}) => {
    const joined = joinedCount(deal.id);
    res.status(status).render('admin/edit', {
      title: `Edit: ${deal.product_name}`,
      deal,
      values,
      errors,
      joined,
      open: deal.status === 'open',
      locked: deal.status !== 'open' || joined > 0,
    });
  };

  router.get('/deals/:id/edit', (req, res, next) => {
    const deal = repo.dealById(Number(req.params.id));
    if (!deal) return next();
    editPage(res, 200, deal, dealToFormValues(deal));
  });

  router.post('/deals/:id/edit', (req, res, next) => {
    const deal = repo.dealById(Number(req.params.id));
    if (!deal) return next();
    const { errors, changes } = validateDealEdit(req.body, deal, { now: clock.now(), joined: joinedCount(deal.id) });
    if (!changes) return editPage(res, 422, deal, { ...dealToFormValues(deal), ...req.body }, errors);
    repo.updateDeal(deal.id, changes);
    const updated = repo.dealById(deal.id);
    ctx.translator?.warmDeal(updated); // edited texts get new translations
    backToDeal(res, deal.id, 'Deal saved.');
  });

  // Cancel an open deal that hasn't reached its minimum: it closes now, nobody is charged and every
  // saved payment method is removed. Buyers get a "deal cancelled" email.
  router.post('/deals/:id/cancel', async (req, res, next) => {
    try {
      const deal = repo.dealById(Number(req.params.id));
      if (!deal) return next();
      if (deal.status !== 'open') return backToDeal(res, deal.id, 'Only open deals can be cancelled.');
      if (repo.committedCount(deal.id) >= deal.min_buyers) {
        return backToDeal(res, deal.id, 'This deal has reached its minimum, so buyers are being charged. Use the withdrawal action per buyer instead.');
      }
      const past = new Date(clock.now().getTime() - 1000).toISOString();
      repo.updateDeal(deal.id, { deadline: past, cancelled_at: clock.now().toISOString() });
      const done = await ctx.engine.expireDeal(deal.id);
      if (!done) {
        repo.updateDeal(deal.id, { deadline: deal.deadline, cancelled_at: null });
        return backToDeal(res, deal.id, 'The deal could not be cancelled just now. Please try again.');
      }
      backToDeal(res, deal.id, 'Deal cancelled. Nobody was charged and the buyers have been told.');
    } catch (err) {
      next(err);
    }
  });

  // Delete a deal nobody ever started joining (a mistake or a test). Its photos are removed too.
  router.post('/deals/:id/delete', (req, res, next) => {
    const deal = repo.dealById(Number(req.params.id));
    if (!deal) return next();
    const photos = repo.photosForDeal(deal.id);
    if (!repo.deleteDeal(deal.id)) {
      return backToDeal(res, deal.id, 'Buyers have joined this deal, so it stays in the records. Cancel it instead.');
    }
    for (const ph of photos) ctx.photos.remove(ph.filename, ph.thumb);
    res.redirect(303, `/admin?flash=${encodeURIComponent(`Deleted "${deal.product_name}".`)}`);
  });
}
