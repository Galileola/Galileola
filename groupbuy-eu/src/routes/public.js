import { isJoinable, publicDealState } from '../dealState.js';

export function publicRoutes(app, ctx) {
  const { repo, clock } = ctx;

  app.get('/', (req, res) => {
    const now = clock.now();
    const deals = repo
      .listPublicDeals()
      .filter((d) => isJoinable(d, now))
      .map((d) => ({ ...d, count: repo.committedCount(d.id), cover: repo.coverPhoto(d.id) }));
    res.render('home', { title: 'Deals', deals });
  });

  app.get('/deals/:slug', (req, res, next) => {
    const deal = repo.dealBySlug(req.params.slug);
    if (!deal) return next();
    const state = publicDealState(deal, repo.committedCount(deal.id), clock.now());
    res.render('deal', { title: deal.product_name, deal, photos: repo.photosForDeal(deal.id), state, values: {}, errors: {} });
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
