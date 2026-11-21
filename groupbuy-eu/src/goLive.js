import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUSINESS_FIELDS, isPlaceholder } from './businessSettings.js';
import { LEGAL_PAGES } from './legalText.js';
import { loadSharp } from './photos.js';

// Admin → Settings → Go-live checklist, and the safety net for real payments: with
// PAYMENTS_MODE=live the shop only takes new orders while every required check passes (complete
// company details, legal pages without [placeholders], email delivery, the Stripe webhook).

const viewsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'views', 'legal');
const builtIn = {};
const builtInText = (page) => (builtIn[page] ??= fs.readFileSync(path.join(viewsDir, `${page}-body.ejs`), 'utf8').replace(/<%[\s\S]*?%>/g, ''));

// "[Delivery costs: …]" is a placeholder; "[stripe.com](https://stripe.com)" is a link.
export const PLACEHOLDER_RE = /\[[^\]\n]{3,}\](?!\()/;
export const isLive = (config) => config.paymentsMode === 'live';

const LEGAL_LABELS = { terms: 'Terms & withdrawal right', privacy: 'Privacy policy', cookies: 'Cookie page' };

let sharpAvailable = null;
loadSharp().then((s) => { sharpAvailable = Boolean(s); });

export function goLiveChecks(ctx) {
  const { config, repo } = ctx;
  const live = isLive(config);
  const checks = [];
  const missing = BUSINESS_FIELDS.filter((f) => isPlaceholder(config.business?.[f.key])).map((f) => f.label.toLowerCase());
  checks.push({
    label: 'Company details',
    ok: !missing.length,
    detail: missing.length ? `Still missing: ${missing.join(', ')}.` : 'Shown in the footer, the legal pages and the emails.',
    href: '/admin/business',
    required: true,
  });
  for (const page of LEGAL_PAGES) {
    const own = repo?.legalText?.(page, 'en');
    const text = own ? own.body : builtInText(page);
    const placeholder = text.match(PLACEHOLDER_RE)?.[0];
    checks.push({
      label: LEGAL_LABELS[page],
      ok: !placeholder,
      detail: placeholder
        ? `Still has a placeholder: ${placeholder.slice(0, 90)}${placeholder.length > 90 ? '…]' : ''} Write your own text (reviewed by a lawyer) in Legal pages.`
        : own ? 'Your own text.' : 'The built-in text.',
      href: `/admin/legal/${page}/en`,
      required: true,
    });
  }
  checks.push({
    label: 'Emails are delivered',
    ok: Boolean(config.smtpUrl),
    detail: config.smtpUrl
      ? 'SMTP_URL is set. Check Admin → Emails: new emails should say "delivered".'
      : 'SMTP_URL is not set, so emails only go to the admin outbox. Buyers must get their confirmations and the SEPA pre-notification.',
    href: '/admin/emails',
    required: true,
  });
  checks.push({
    label: 'Stripe webhook',
    ok: Boolean(config.stripeWebhookSecret),
    detail: config.stripeWebhookSecret
      ? `STRIPE_WEBHOOK_SECRET is set. The webhook must point to ${config.baseUrl}/webhooks/stripe in Stripe's ${live ? 'live' : 'test'} mode.`
      : 'STRIPE_WEBHOOK_SECRET is not set, so payments that finish later (SEPA, 3-D Secure) are not recorded.',
    required: true,
  });
  checks.push({
    label: 'Payments',
    ok: live,
    detail: live
      ? 'Real payments: PAYMENTS_MODE=live with live Stripe keys.'
      : 'Test mode: no real money is taken. To go live, set PAYMENTS_MODE=live and the live Stripe keys and webhook secret in the hosting panel (see the README, "Going live").',
    required: false,
  });
  checks.push({
    label: 'Scheduler',
    ok: true,
    detail: config.schedulerIntervalMs
      ? 'Runs inside the app every minute. On Hostinger web hosting also keep the hPanel cron job for /api/cron/tick, because the app sleeps when idle.'
      : 'Runs only when /api/cron/tick is called: keep the hPanel cron job running every minute.',
    required: false,
  });
  checks.push({
    label: 'AI features',
    ok: Boolean(config.anthropicApiKey),
    detail: config.anthropicApiKey
      ? 'On: shopping assistant, Snap a deal, Write with AI and the translations of deals into every language.'
      : 'Off: set ANTHROPIC_API_KEY to translate deals into the other 24 languages and turn on the assistant and Snap a deal.',
    required: false,
  });
  checks.push({
    label: 'Photo resizing',
    ok: sharpAvailable !== false,
    detail: sharpAvailable === false ? 'sharp is not installed, so photos are shown at full size. Run npm install on the server.' : 'Photos are resized and thumbnails made.',
    required: false,
  });
  return checks;
}

// Problems that stop new orders while real payments are on (none in test mode).
export function liveProblems(ctx) {
  if (!isLive(ctx.config)) return [];
  return goLiveChecks(ctx).filter((c) => c.required && !c.ok);
}

export const ordersOpen = (ctx) => liveProblems(ctx).length === 0;
