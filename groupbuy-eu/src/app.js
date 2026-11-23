import crypto from 'node:crypto';
import fs from 'node:fs';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { photoUrl, thumbUrl } from './photos.js';
import { languageMiddleware } from './i18n/middleware.js';
import { loadCategories } from './categories.js';
import { loadShopLanguages } from './shopLanguages.js';
import { loadDeliveryCountries } from './deliveryCountries.js';
import { hasOptionalCookies } from './cookies.js';
import { applyBusinessSettings } from './businessSettings.js';
import { applyBranding, currentBrand } from './branding.js';
import { analyticsMiddleware, createAnalytics } from './analytics.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// '/static/css/site.css' -> '/static/css/site.css?v=<first 10 characters of its hash>'.
const assetVersions = new Map();
export function asset(url) {
  if (!assetVersions.has(url)) {
    let v = '';
    try {
      v = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'public', url.replace(/^\/static\//, '')))).digest('hex').slice(0, 10);
    } catch {
      /* missing file: link it without a version */
    }
    assetVersions.set(url, v ? `${url}?v=${v}` : url);
  }
  return assetVersions.get(url);
}

// ctx = { config, repo, stripe, mailer, clock, engine }
export function createApp(ctx) {
  const { config } = ctx;
  const app = express();
  // Settings the owner changes in the admin: categories and the company details.
  loadCategories(ctx.repo);
  loadShopLanguages(ctx.repo, config);
  loadDeliveryCountries(ctx.repo, config);
  applyBusinessSettings(config, ctx.repo);
  if (ctx.repo?.getAdminSetting) applyBranding(config, ctx.repo);
  // Visit statistics for Admin → Performance (no cookies; see src/analytics.js).
  if (ctx.analytics === undefined && ctx.repo?.insertVisit) ctx.analytics = createAnalytics({ repo: ctx.repo, clock: ctx.clock, config });

  app.set('view engine', 'ejs');
  app.set('views', path.join(root, 'views'));
  app.set('trust proxy', config.trustProxy ?? 1);
  app.disable('x-powered-by');

  // One address for the shop: requests that reach it under another domain (an old address such
  // as shop.example.com, or www.example.com) are sent to BASE_URL with the same path. Health
  // checks, Stripe webhooks and the cron endpoints are answered where they arrive, because those
  // callers don't follow redirects.
  const canonical = canonicalHost(config.baseUrl);
  if (canonical) {
    app.use((req, res, next) => {
      const host = (req.hostname || '').toLowerCase();
      if (!host || host === canonical || isLocalHost(host)) return next();
      if (req.path === '/healthz' || req.path.startsWith('/webhooks/') || req.path.startsWith('/api/cron/')) return next();
      const status = req.method === 'GET' || req.method === 'HEAD' ? 301 : 308;
      res.redirect(status, config.baseUrl + req.originalUrl);
    });
  }

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': [
        "default-src 'self'",
        // Stripe.js / Payment Element / 3-D Secure, per https://docs.stripe.com/security/guide#content-security-policy
        "script-src 'self' https://js.stripe.com https://*.js.stripe.com",
        "frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com",
        "connect-src 'self' https://api.stripe.com",
        // blob: lets the snap page preview and shrink camera photos before uploading them.
        "img-src 'self' https: data: blob:",
        "style-src 'self' 'unsafe-inline'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "base-uri 'self'",
        "object-src 'none'",
      ].join('; '),
      // Browser features the shop doesn't use are switched off; payments may use the browser's
      // payment sheet (Apple Pay / Google Pay through Stripe).
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), serial=(), bluetooth=(), payment=(self "https://js.stripe.com")',
      // Keeps other sites' windows from scripting this one (popups for 3-D Secure still work).
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    });
    // Browsers remember to use HTTPS only (once the shop is served over HTTPS).
    if (/^https:/.test(config.baseUrl || '')) res.set('Strict-Transport-Security', 'max-age=31536000');
    res.locals.business = config.business;
    res.locals.brand = currentBrand(config); // shop name, logo, icons, share picture (src/branding.js)
    res.locals.testMode = config.paymentsMode !== 'live'; // the yellow "test mode" banner
    res.locals.optionalCookies = hasOptionalCookies(config); // the cookie notice asks only when there are some (src/cookies.js)
    res.locals.loadStripe = false; // payment pages switch this on (Stripe.js only where needed)
    res.locals.title = 'Group Buy';
    res.locals.asset = asset;
    res.locals.photoUrl = photoUrl;
    res.locals.thumbUrl = thumbUrl;
    res.locals.assistantEnabled = Boolean(ctx.assistant); // the admin router switches it off
    res.locals.isAdmin = false; // the admin router switches it on
    res.locals.baseUrl = config.baseUrl;
    // Buyers' private pages (their links hold a secret) and the admin stay out of search engines
    // and link previews.
    res.locals.noindex = /^\/(join|pay|admin|api|alerts)(\/|$)/.test(req.path) || Boolean(req.query.q);
    res.locals.meta = null; // link preview and search details; pages set their own (src/seo.js)
    next();
  });
  // The visitor's language: t(), prices, dates, countries and categories (src/i18n).
  app.use(languageMiddleware(ctx));
  app.use(analyticsMiddleware(ctx));

  // CSS and scripts are linked with ?v=<content hash> (asset() below), so browsers can keep them
  // for a year and still get a changed file at once. Other static files: 1 hour.
  const publicDir = path.join(root, 'public');
  const staticFiles = express.static(publicDir, { cacheControl: false });
  app.use('/static', (req, res, next) => {
    res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
    staticFiles(req, res, next);
  });
  // Product photos have random, never-reused names, so they can be cached for a long time.
  if (config.uploadDir) {
    app.use(
      '/uploads',
      express.static(config.uploadDir, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny', redirect: false })
    );
  }
  // Only parses application/x-www-form-urlencoded; the Stripe webhook keeps its raw JSON body.
  // (Admin → Legal pages and the import preview post long forms and parse their own.)
  const formParser = express.urlencoded({ extended: false, limit: '100kb' });
  const ownParser = (p) => p.startsWith('/admin/legal/') || p === '/admin/import/confirm';
  app.use((req, res, next) => (ownParser(req.path) ? next() : formParser(req, res, next)));

  // Routes are added step by step (see src/routes/*).
  for (const mount of ctx.routes ?? []) mount(app, ctx);

  app.use((req, res) => {
    const { t } = res.locals;
    res.status(404).render('message', {
      title: t('errors.notFoundTitle'),
      emoji: '🙈',
      heading: t('errors.notFoundHeading'),
      body: t('errors.notFoundBody'),
      link: { href: '/#deals', label: t('errors.backToDeals') },
    });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (!err.status || err.status >= 500) console.error('[error]', err);
    const t = res.locals.t ?? ((key) => key);
    res.status(err.status || 500).render('message', {
      title: t('errors.title'),
      emoji: '😵',
      heading: t('errors.heading'),
      body: err.expose ? err.message : t('errors.body'),
    });
  });

  return app;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

// The host name of BASE_URL when it is a public https address, else null (local development).
export function canonicalHost(baseUrl) {
  try {
    const u = new URL(baseUrl);
    return u.protocol === 'https:' && !isLocalHost(u.hostname) ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

// localhost and bare IP addresses (the host's own health checks) are never redirected.
function isLocalHost(host) {
  return host === 'localhost' || /^[\d.]+$/.test(host) || host.includes(':') || host.endsWith('.localhost');
}
