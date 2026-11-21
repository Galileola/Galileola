import { isLanguage } from './i18n/index.js';
import path from 'node:path';

// Configuration, read from environment variables (see .env.example).
// The app takes Stripe TEST-mode keys only, unless PAYMENTS_MODE=live (see assertLiveModeKeys).

export class ConfigError extends Error {}

export function assertTestModeKeys({ stripeSecretKey, stripePublishableKey }) {
  if (!stripeSecretKey || !/^(sk|rk)_test_/.test(stripeSecretKey)) {
    throw new ConfigError(
      'Refusing to start: STRIPE_SECRET_KEY must be a Stripe test-mode key (sk_test_… or rk_test_…). Live keys are not allowed.'
    );
  }
  if (!stripePublishableKey || !/^pk_test_/.test(stripePublishableKey)) {
    throw new ConfigError(
      'Refusing to start: STRIPE_PUBLISHABLE_KEY must be a Stripe test-mode key (pk_test_…). Live keys are not allowed.'
    );
  }
}

// PAYMENTS_MODE=live takes real payments: it needs live keys, the webhook secret and an email
// server (buyers must get their confirmations and the SEPA pre-notification). The shop also
// pauses new orders until the company details and legal pages are complete (src/goLive.js).
export function assertLiveModeKeys({ stripeSecretKey, stripePublishableKey, stripeWebhookSecret, smtpUrl }) {
  if (!stripeSecretKey || !/^(sk|rk)_live_/.test(stripeSecretKey)) {
    throw new ConfigError('Refusing to start: PAYMENTS_MODE=live needs a live STRIPE_SECRET_KEY (sk_live_… or rk_live_…).');
  }
  if (!stripePublishableKey || !/^pk_live_/.test(stripePublishableKey)) {
    throw new ConfigError('Refusing to start: PAYMENTS_MODE=live needs a live STRIPE_PUBLISHABLE_KEY (pk_live_…).');
  }
  if (!stripeWebhookSecret) {
    throw new ConfigError('Refusing to start: PAYMENTS_MODE=live needs STRIPE_WEBHOOK_SECRET from the live-mode webhook in the Stripe Dashboard.');
  }
  if (!smtpUrl) {
    throw new ConfigError('Refusing to start: PAYMENTS_MODE=live needs SMTP_URL, so buyers get their emails.');
  }
}

export function loadConfig(env = process.env) {
  const port = Number(env.PORT || 3000);
  const config = {
    port,
    baseUrl: (env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
    dbPath: env.DATABASE_PATH || './data/groupbuy.sqlite',
    sqliteJournalMode: env.SQLITE_JOURNAL_MODE || 'WAL',
    backupKeep: Number(env.BACKUP_KEEP || 14),
    // Express "trust proxy": 1 = one reverse proxy in front (Hostinger, nginx, Caddy). 0 = none.
    trustProxy: env.TRUST_PROXY === undefined ? 1 : /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY,

    // 'test' (default): Stripe test keys only. 'live': real payments (see assertLiveModeKeys).
    paymentsMode: String(env.PAYMENTS_MODE || 'test').trim().toLowerCase() === 'live' ? 'live' : 'test',
    stripeSecretKey: env.STRIPE_SECRET_KEY,
    stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,

    adminUser: env.ADMIN_USER || 'admin',
    adminPassword: env.ADMIN_PASSWORD,
    appSecret: env.APP_SECRET,
    cronSecret: env.CRON_SECRET,
    schedulerIntervalMs: Number(env.SCHEDULER_INTERVAL_MS || 60_000),
    joinRateLimit: Number(env.JOIN_RATE_LIMIT || 10), // joins per IP per 15 minutes

    smtpUrl: env.SMTP_URL || '',
    mailFrom: env.MAIL_FROM || 'Group Buy <no-reply@example.com>',

    defaultTaxCode: env.DEFAULT_TAX_CODE || 'txcd_99999999', // "General - Tangible Goods"

    // Product photos. Default: an "uploads" folder next to the database, so it is outside the
    // app folder whenever DATABASE_PATH is (Hostinger replaces the app folder on redeploy).
    uploadDir: env.UPLOAD_DIR || '',

    // AI shopping assistant (chat on the public pages). Off until ANTHROPIC_API_KEY is set.
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    assistantModel: env.ASSISTANT_MODEL || 'claude-opus-5-5',
    // The language deals are written in (they're translated into the others with the same key).
    contentLanguage: isLanguage(env.CONTENT_LANGUAGE) ? env.CONTENT_LANGUAGE : 'en',
    translationDailyLimit: Number(env.TRANSLATION_DAILY_LIMIT || 500), // Claude translation requests per day
    assistantRateLimit: Number(env.ASSISTANT_RATE_LIMIT || 30), // messages per IP per 15 minutes
    assistantDailyLimit: Number(env.ASSISTANT_DAILY_LIMIT || 1000), // messages per day, whole site

    business: {
      name: env.BUSINESS_NAME || '[Your company name]',
      address: env.BUSINESS_ADDRESS || '[Street, postcode, city, country]',
      email: env.BUSINESS_EMAIL || '[contact@example.com]',
      vatId: env.BUSINESS_VAT_ID || '[EU VAT number]',
      registration: env.BUSINESS_REGISTRATION || '[Company register and number]',
      supervisoryAuthority: env.BUSINESS_DPA || '[Your national data protection authority]',
    },
  };

  config.backupDir = env.BACKUP_DIR || path.join(path.dirname(path.resolve(config.dbPath)), 'backups');
  config.uploadDir = config.uploadDir || path.join(path.dirname(path.resolve(config.dbPath)), 'uploads');
  if (config.paymentsMode === 'live') assertLiveModeKeys(config);
  else assertTestModeKeys(config);
  if (!config.adminPassword) throw new ConfigError('ADMIN_PASSWORD is required.');
  if (!config.appSecret || config.appSecret.length < 16) {
    throw new ConfigError('APP_SECRET is required (at least 16 characters).');
  }
  if (!config.stripeWebhookSecret) {
    console.warn('[config] STRIPE_WEBHOOK_SECRET is not set: /webhooks/stripe will reject all events.');
  }
  return config;
}
