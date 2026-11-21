import { isJoinable } from '../dealState.js';
import { LANGUAGES } from '../i18n/index.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// robots.txt and sitemap.xml, so search engines find every open deal in every language.
export function seoRoutes(app, ctx) {
  const { repo, config, clock } = ctx;

  app.get('/robots.txt', (req, res) => {
    res
      .type('text/plain')
      .set('Cache-Control', 'public, max-age=3600')
      .send(
        [
          'User-agent: *',
          'Allow: /',
          // Admin, buyers' private pages and the machine endpoints aren't for search engines.
          'Disallow: /admin',
          'Disallow: /join/',
          'Disallow: /pay/',
          'Disallow: /api/',
          'Disallow: /webhooks/',
          '',
          `Sitemap: ${config.baseUrl}/sitemap.xml`,
          '',
        ].join('\n')
      );
  });

  // Every page in every language, each listing its other languages (hreflang).
  app.get('/sitemap.xml', (req, res) => {
    const now = clock.now();
    const deals = repo.listPublicDeals().filter((d) => isJoinable(d, now));
    const newest = deals.map((d) => d.created_at).sort().at(-1);
    const pages = [
      { path: '/', lastmod: newest, priority: '1.0' },
      ...deals.map((d) => ({ path: `/deals/${d.slug}`, lastmod: d.created_at, priority: '0.8' })),
      { path: '/terms', priority: '0.2' },
      { path: '/privacy', priority: '0.2' },
      { path: '/cookies', priority: '0.1' },
    ];
    const url = (path, code) => `${config.baseUrl}${path}?lang=${code}`;
    const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'];
    for (const page of pages) {
      const alternates = [
        ...LANGUAGES.map((l) => `    <xhtml:link rel="alternate" hreflang="${l.code}" href="${esc(url(page.path, l.code))}"/>`),
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(url(page.path, 'en'))}"/>`,
      ].join('\n');
      for (const l of LANGUAGES) {
        out.push('  <url>', `    <loc>${esc(url(page.path, l.code))}</loc>`);
        if (page.lastmod) out.push(`    <lastmod>${esc(new Date(page.lastmod).toISOString().slice(0, 10))}</lastmod>`);
        out.push(`    <priority>${page.priority}</priority>`, alternates, '  </url>');
      }
    }
    out.push('</urlset>', '');
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(out.join('\n'));
  });
}
