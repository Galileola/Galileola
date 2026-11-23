import { isJoinable } from '../dealState.js';
import { mainLanguage, shopLanguages, translate } from '../i18n/index.js';
import { currentBrand, webManifest } from '../branding.js';

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
          'Disallow: /alerts/',
          'Disallow: /webhooks/',
          '',
          `Sitemap: ${config.baseUrl}/sitemap.xml`,
          '',
        ].join('\n')
      );
  });

  // How to report a security problem (RFC 9116), to the shop's contact email.
  app.get('/.well-known/security.txt', (req, res) => {
    const email = config.business?.email;
    if (!email || email.startsWith('[')) return res.status(404).type('text/plain').send('Not found');
    const expires = new Date(clock.now().getTime() + 180 * 24 * 3600_000).toISOString();
    res
      .type('text/plain')
      .set('Cache-Control', 'public, max-age=86400')
      .send([`Contact: mailto:${email}`, `Expires: ${expires}`, 'Preferred-Languages: en', `Canonical: ${config.baseUrl}/.well-known/security.txt`, ''].join('\n'));
  });

  // The web app manifest, so phones can add the shop to the home screen with its icon.
  app.get('/manifest.webmanifest', (req, res) => {
    const brand = currentBrand(config);
    const lang = config.contentLanguage ?? 'en';
    res
      .type('application/manifest+json')
      .set('Cache-Control', 'public, max-age=3600')
      .send(JSON.stringify(webManifest(brand, { lang, description: translate(lang, 'home.lead') }), null, 2));
  });
  // Browsers and phones ask for these at the root even when the page names other files.
  app.get('/favicon.ico', (req, res) => res.redirect(301, currentBrand(config).icons.favicon));
  app.get(['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png'], (req, res) => res.redirect(301, currentBrand(config).icons.appleTouch));

  // Every page in every language, each listing its other languages (hreflang).
  app.get('/sitemap.xml', (req, res) => {
    const now = clock.now();
    const languages = shopLanguages();
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
        ...languages.map((l) => `    <xhtml:link rel="alternate" hreflang="${l.code}" href="${esc(url(page.path, l.code))}"/>`),
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(url(page.path, mainLanguage()))}"/>`,
      ].join('\n');
      for (const l of languages) {
        out.push('  <url>', `    <loc>${esc(url(page.path, l.code))}</loc>`);
        if (page.lastmod) out.push(`    <lastmod>${esc(new Date(page.lastmod).toISOString().slice(0, 10))}</lastmod>`);
        out.push(`    <priority>${page.priority}</priority>`, alternates, '  </url>');
      }
    }
    out.push('</urlset>', '');
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(out.join('\n'));
  });
}
