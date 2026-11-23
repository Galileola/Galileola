import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUSINESS_FIELDS, isPlaceholder } from './businessSettings.js';
import { LEGAL_PAGES } from './legalText.js';
import { loadSharp } from './photos.js';
import { MIN_PASSWORD_LENGTH, passwordChangedInAdmin } from './adminPassword.js';
import { ENGLISH_NAMES, mainLanguage, shopLanguages } from './i18n/index.js';
import { builtInTranslationView } from './routes/legal.js';

// Admin → Settings → Go-live checklist, and the safety net for real payments: with
// PAYMENTS_MODE=live the shop only takes new orders while every required check passes (complete
// company details, legal pages without [placeholders], email delivery, the Stripe webhook).

const viewsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'views', 'legal');
const builtIn = {};
const stripEjs = (file) => fs.readFileSync(file, 'utf8').replace(/<%[\s\S]*?%>/g, '');
const builtInText = (page) => (builtIn[page] ??= stripEjs(path.join(viewsDir, `${page}-body.ejs`)));
// A built-in translation, e.g. 'legal/terms-body.et.ejs' (see builtInTranslationView).
const builtInFile = (view) => (builtIn[view] ??= stripEjs(path.join(viewsDir, '..', view)));

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
  const missing = BUSINESS_FIELDS.filter((f) => isPlaceholder(config.business?.[f.key])).map((f) => f.label);
  checks.push({
    label: 'Company details',
    ok: !missing.length,
    detail: missing.length ? `Still missing: ${missing.join(', ')}.` : 'Shown in the footer, the legal pages and the emails.',
    href: '/admin/business',
    required: true,
  });
  const placeholders = (text) => [...text.matchAll(new RegExp(PLACEHOLDER_RE.source, 'g'))].map((m) => m[0]);
  const languages = shopLanguages().map((l) => l.code);
  for (const page of LEGAL_PAGES) {
    const ownEnglish = repo?.legalText?.(page, 'en');
    // The text visitors in each language the shop offers see (src/routes/legal.js): the owner's
    // text for that language; else, while the English text is the built-in one, the built-in
    // translation; else the English text (translated automatically, [placeholders] and all).
    const seen = (code) => {
      const own = code !== 'en' ? repo?.legalText?.(page, code) : null;
      if (own) return { text: own.body, own: true };
      const view = !ownEnglish ? builtInTranslationView(page, code) : null;
      if (view) return { text: builtInFile(view), own: false };
      return { text: ownEnglish ? ownEnglish.body : builtInText(page), own: Boolean(ownEnglish) };
    };
    const results = languages.map((code) => ({ code, ...seen(code) }));
    const unfinished = results.map((r) => ({ ...r, found: placeholders(r.text) })).filter((r) => r.found.length);
    // English first when it's unfinished: the other languages are made from it.
    const first = unfinished.find((r) => r.code === 'en') ?? unfinished[0];
    // The template's own note "Text in [brackets] must be completed" counts, but a real example
    // is more useful to show.
    const all = first?.found ?? [];
    const example = all.find((p) => p !== '[brackets]') ?? all[0];
    const where = !first || first.code === 'en' ? '' : ` (${unfinished.map((r) => ENGLISH_NAMES[r.code]).join(', ')})`;
    checks.push({
      label: LEGAL_LABELS[page],
      ok: !unfinished.length,
      detail: all.length
        ? `${all.length === 1 ? 'Still has a placeholder' : `Still has ${all.length} placeholders, for example`}${where}: ${example.length > 90 ? `${example.slice(0, 89)}…]` : example} Write your own text (reviewed by a lawyer) in Legal pages.`
        : results.some((r) => r.own) ? 'Your own text.' : 'The built-in text.',
      href: `/admin/legal/${page}/${first?.code ?? (languages.includes('en') ? 'en' : mainLanguage())}`,
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
  const strongPassword = passwordChangedInAdmin(config, repo) || String(config.adminPassword ?? '').length >= MIN_PASSWORD_LENGTH;
  checks.push({
    label: 'Admin password',
    ok: strongPassword,
    detail: strongPassword
      ? 'Long enough.'
      : `ADMIN_PASSWORD is shorter than ${MIN_PASSWORD_LENGTH} characters. Change it in Settings → Password (or set a longer one in the hosting panel).`,
    href: '/admin/password',
    required: true,
  });
  // The examples in .env.example are public (the code is on GitHub): anyone could use them.
  const examples = [
    ['APP_SECRET', config.appSecret],
    ['CRON_SECRET', config.cronSecret],
    ['ADMIN_PASSWORD', passwordChangedInAdmin(config, repo) ? '' : config.adminPassword],
  ].filter(([, value]) => isExampleSecret(value)).map(([name]) => name);
  checks.push({
    label: 'Secrets',
    ok: !examples.length,
    detail: examples.length
      ? `${examples.join(', ')} still ${examples.length === 1 ? 'has its example value' : 'have their example values'} from .env.example. Set long random values in the hosting panel and restart the app.`
      : 'Not the example values.',
    required: true,
  });
  const twoStep = repo?.getAdminSetting?.('admin_two_step');
  checks.push({
    label: 'Two-step login',
    ok: Boolean(twoStep) && config.adminTwoStep !== 'off',
    detail: twoStep && config.adminTwoStep !== 'off'
      ? 'On: the admin asks for a code from your phone after the password.'
      : 'Recommended: a code from your phone after the password, so a stolen password alone can\'t open the admin.',
    href: '/admin/security',
    required: false,
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

// Values copied from .env.example: "change-me", "change-me-too", "change-me-to-a-long-random-string".
export const isExampleSecret = (value) => /^change[-_ ]?me/i.test(String(value ?? '').trim());

// Problems that stop new orders while real payments are on (none in test mode).
export function liveProblems(ctx) {
  if (!isLive(ctx.config)) return [];
  return goLiveChecks(ctx).filter((c) => c.required && !c.ok);
}

export const ordersOpen = (ctx) => liveProblems(ctx).length === 0;
