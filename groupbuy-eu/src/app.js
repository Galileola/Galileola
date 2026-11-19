import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatEuro, formatDate, EU_COUNTRIES } from './util.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ctx = { config, repo, stripe, mailer, clock, engine }
export function createApp(ctx) {
  const { config } = ctx;
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(root, 'views'));
  app.set('trust proxy', config.trustProxy ?? 1);
  app.disable('x-powered-by');

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
        "img-src 'self' https: data:",
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
    next();
  });

  app.use('/static', express.static(path.join(root, 'public'), { maxAge: '1h' }));
  // Only parses application/x-www-form-urlencoded; the Stripe webhook keeps its raw JSON body.
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  // Routes are added step by step (see src/routes/*).
  for (const mount of ctx.routes ?? []) mount(app, ctx);

  app.use((req, res) => res.status(404).render('message', { title: 'Not found', heading: 'Page not found', body: '' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (!err.status || err.status >= 500) console.error('[error]', err);
    res.status(err.status || 500).render('message', {
      title: 'Error',
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
