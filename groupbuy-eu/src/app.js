import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatEuro, formatDate, EU_COUNTRIES } from './util.js';
import { photoUrl } from './photos.js';
import { CATEGORIES, categoryFor } from './categories.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ctx = { config, repo, stripe, mailer, clock, engine }
export function createApp(ctx) {
  const { config } = ctx;
  const app = express();

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
      ].join('; '),
    });
    res.locals.formatEuro = formatEuro;
    res.locals.formatDate = formatDate;
    res.locals.countries = EU_COUNTRIES;
    res.locals.business = config.business;
    res.locals.loadStripe = false; // payment pages switch this on (Stripe.js only where needed)
    res.locals.title = 'Group Buy';
    res.locals.photoUrl = photoUrl;
    res.locals.assistantEnabled = Boolean(ctx.assistant); // the admin router switches it off
    res.locals.isAdmin = false; // the admin router switches it on
    res.locals.categories = CATEGORIES;
    res.locals.categoryFor = categoryFor;
    res.locals.baseUrl = config.baseUrl;
    next();
  });

  app.use('/static', express.static(path.join(root, 'public'), { maxAge: '1h' }));
  // Product photos have random, never-reused names, so they can be cached for a long time.
  if (config.uploadDir) {
    app.use(
      '/uploads',
      express.static(config.uploadDir, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny', redirect: false })
    );
  }
  // Only parses application/x-www-form-urlencoded; the Stripe webhook keeps its raw JSON body.
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  // Routes are added step by step (see src/routes/*).
  for (const mount of ctx.routes ?? []) mount(app, ctx);

  app.use((req, res) =>
    res.status(404).render('message', {
      title: 'Not found',
      emoji: '🙈',
      heading: 'This page wandered off',
      body: "We couldn't find it. The deals are still where you left them, though.",
      link: { href: '/#deals', label: 'Back to the deals' },
    })
  );

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (!err.status || err.status >= 500) console.error('[error]', err);
    res.status(err.status || 500).render('message', {
      title: 'Error',
      emoji: '😵',
      heading: 'Something went wrong',
      body: err.expose ? err.message : 'Please try again in a moment.',
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
