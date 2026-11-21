import { isJoinable, publicDealState } from '../dealState.js';
import { isCategory } from '../categories.js';
import { HOUR } from '../util.js';
import { dealMeta, homeMeta } from '../seo.js';

export function publicRoutes(app, ctx) {
  const { repo, clock } = ctx;

  app.get('/', (req, res) => {
    const now = clock.now();
    const { localizeDeal, t } = res.locals;
    const all = repo
      .listPublicDeals()
      .filter((d) => isJoinable(d, now))
      .map((d) => withBadges({ ...localizeDeal(d), count: repo.committedCount(d.id), cover: repo.coverPhoto(d.id) }, now));
    const category = isCategory(req.query.category) ? res.locals.categoryFor(req.query.category) : null;
    const deals = category ? all.filter((d) => d.category === category.slug) : all;
    const perCategory = {};
    for (const d of all) perCategory[d.category] = (perCategory[d.category] ?? 0) + 1;
    const cover = (category ? deals : all).find((d) => d.cover)?.cover;
    res.locals.meta = homeMeta({ t, cover, baseUrl: ctx.config.baseUrl, business: ctx.config.business });
    res.render('home', {
      title: category ? t('home.titleCategory', { category: category.name }) : t('home.title'),
      deals,
      category,
      perCategory,
      stats: {
        open: all.length,
        buyers: all.reduce((n, d) => n + d.count, 0),
        hot: all.filter((d) => d.badge === 'hot').length,
      },
    });
  });

  app.get('/deals/:slug', (req, res, next) => {
    const found = repo.dealBySlug(req.params.slug);
    if (!found) return next();
    const deal = res.locals.localizeDeal(found);
    const state = publicDealState(deal, repo.committedCount(deal.id), clock.now());
    const photos = repo.photosForDeal(deal.id);
    res.locals.trackDealId = deal.id;
    const { lang, formatEuro, categoryFor } = res.locals;
    // The owner's search title and description are written in the shop's main language.
    const seo = lang === (ctx.config.contentLanguage ?? 'en') ? { title: found.seo_title, description: found.seo_description } : {};
    res.locals.meta = dealMeta({
      deal, photos, state, lang, formatEuro, baseUrl: ctx.config.baseUrl, business: ctx.config.business, categoryName: categoryFor(deal.category).name, seo,
    });
    res.render('deal', { title: seo.title || deal.product_name, deal, photos, state, values: {}, errors: {} });
  });

  app.get('/api/deals/:slug', (req, res) => {
    const deal = repo.dealBySlug(req.params.slug);
    if (!deal) return res.status(404).json({ error: 'not_found' });
    res.set('Cache-Control', 'no-store');
    res.json(publicDealState(deal, repo.committedCount(deal.id), clock.now()));
  });

  for (const extend of ctx.publicExtensions ?? []) extend(app, ctx);
}

export { isJoinable };

// Fun labels for the deal cards. `badge` is one of: on, ending, hot, new, or null.
export function withBadges(d, now) {
  const percent = Math.min(100, Math.round((d.count / d.min_buyers) * 100));
  const hoursLeft = (new Date(d.deadline) - now) / HOUR;
  const ageHours = (now - new Date(d.created_at)) / HOUR;
  let badge = null;
  if (d.status !== 'open') badge = 'on';
  else if (hoursLeft < 24) badge = 'ending';
  else if (percent >= 70) badge = 'hot';
  else if (ageHours < 72) badge = 'new';
  return { ...d, percent, remaining: Math.max(0, d.min_buyers - d.count), badge };
}
