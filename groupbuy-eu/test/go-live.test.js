import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDb, createRepo } from '../src/db.js';
import { loadConfig, ConfigError } from '../src/config.js';
import { systemClock, hmac } from '../src/util.js';
import { publicRoutes } from '../src/routes/public.js';
import { joinRoutes } from '../src/routes/join.js';
import { webhookRoutes } from '../src/routes/webhooks.js';
import { adminRoutes } from '../src/routes/admin.js';
import { createPhotoStore } from '../src/photos.js';
import { PLACEHOLDER_RE, goLiveChecks, liveProblems } from '../src/goLive.js';

const base = { ADMIN_PASSWORD: 'pw', APP_SECRET: 'a-long-app-secret-123', DATABASE_PATH: ':memory:' };

test('PAYMENTS_MODE=live needs live keys, the webhook secret and an email server', () => {
  const live = { ...base, PAYMENTS_MODE: 'live', STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_PUBLISHABLE_KEY: 'pk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', SMTP_URL: 'smtps://u:p@mail.test' };
  assert.equal(loadConfig(live).paymentsMode, 'live');
  assert.throws(() => loadConfig({ ...live, STRIPE_SECRET_KEY: 'sk_test_x' }), (e) => e instanceof ConfigError && /live STRIPE_SECRET_KEY/.test(e.message));
  assert.throws(() => loadConfig({ ...live, STRIPE_PUBLISHABLE_KEY: 'pk_test_x' }), /live STRIPE_PUBLISHABLE_KEY/);
  assert.throws(() => loadConfig({ ...live, STRIPE_WEBHOOK_SECRET: '' }), /STRIPE_WEBHOOK_SECRET/);
  assert.throws(() => loadConfig({ ...live, SMTP_URL: '' }), /SMTP_URL/);
  // The default stays test mode, which still refuses live keys.
  assert.equal(loadConfig({ ...base, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLISHABLE_KEY: 'pk_test_x' }).paymentsMode, 'test');
  assert.throws(() => loadConfig({ ...base, STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_PUBLISHABLE_KEY: 'pk_live_x' }), /test-mode key/);
});

test('placeholders in legal texts are found, links are not', () => {
  assert.ok(PLACEHOLDER_RE.test('Delivery: [Delivery costs: list them per country.]'));
  assert.ok(!PLACEHOLDER_RE.test('See [stripe.com/privacy](https://stripe.com/privacy).'));
});

const COMPLETE = { name: 'SEK Digital OÜ', address: 'Narva mnt 5, Tallinn', email: 'hello@sek.test', vatId: 'EE102345678', registration: 'Registry code 1', supervisoryAuthority: 'AKI' };

async function startApp({ live = true, business } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-live-'));
  const config = {
    baseUrl: 'https://shop.test', adminUser: 'admin', adminPassword: 'secret-pw', appSecret: 'test-secret-0123456789abcdef',
    defaultTaxCode: 'txcd_99999999', uploadDir: path.join(dir, 'uploads'), trustProxy: false, quietEmails: true,
    paymentsMode: live ? 'live' : 'test', smtpUrl: 'smtps://u:p@mail.test', stripeWebhookSecret: 'whsec_x',
    business: business ?? { name: '[Your company name]', address: '[Street]', email: '[contact@example.com]', vatId: '[EU VAT number]', registration: '[Register]', supervisoryAuthority: '[DPA]' },
  };
  const repo = createRepo(openDb(path.join(dir, 'db.sqlite')));
  const stripe = { webhooks: { constructEvent: (body) => JSON.parse(body) } };
  const engine = { handleEvent: async () => {}, startJoin: async () => { throw new Error('should not be called'); } };
  const ctx = { config, repo, clock: systemClock, stripe, engine, photos: createPhotoStore(config.uploadDir), routes: [webhookRoutes, publicRoutes, joinRoutes, adminRoutes] };
  const server = createApp(ctx).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:secret-pw').toString('base64') };
  const deal = repo.insertDeal({ slug: 'lamp-1', product_name: 'Oak lamp', description: '', image_url: '', price_cents: 4900, tax_code: 'txcd_99999999', min_buyers: 2, deadline: new Date(Date.now() + 3 * 86400000).toISOString(), created_at: new Date().toISOString() });
  const get = async (p, headers = {}) => (await fetch(url + p, { headers })).text();
  return { url, auth, repo, ctx, deal, get, close: () => server.close() };
}

test('live mode: orders wait until the company details and legal pages are complete', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const problems = liveProblems(app.ctx).map((p) => p.label);
  assert.deepEqual(problems, ['Company details', 'Terms & withdrawal right', 'Privacy policy']);

  const page = await app.get('/deals/lamp-1?lang=en');
  assert.doesNotMatch(page, /class="test-banner"/, 'no test banner with real payments');
  assert.doesNotMatch(page, /action="\/deals\/lamp-1\/join"/, 'no join form while paused');
  const join = await fetch(`${app.url}/deals/lamp-1/join`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=A&email=a%40b.ee' });
  assert.equal(join.status, 409);
  assert.match(await join.text(), /This deal is closed to new buyers/);

  const admin = await app.get('/admin', app.auth);
  assert.match(admin, /Real payments are on, but the shop isn&#39;t taking new orders yet|Real payments are on, but the shop isn't taking new orders yet/);
  assert.match(admin, /Company details, Terms &amp; withdrawal right, Privacy policy/);
  const checklist = await app.get('/admin/go-live', app.auth);
  assert.match(checklist, /<strong>3 of 6<\/strong> required items done/);
  assert.match(checklist, /Still has a placeholder: \[/);
  assert.doesNotMatch(await app.get(`/admin/deals/${app.deal.id}`, app.auth), /Test-mode tools/);
  const tool = await fetch(`${app.url}/admin/deals/${app.deal.id}/test/expire-now`, { method: 'POST', headers: { ...app.auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `_csrf=${hmac('test-secret-0123456789abcdef', 'admin-csrf')}` });
  assert.equal(tool.status, 404, 'test tools are gone');

  // Complete everything: orders open.
  Object.assign(app.ctx.config.business, COMPLETE);
  const now = new Date().toISOString();
  app.repo.saveLegalText('terms', 'en', '# Terms\n\nDelivery within 5 days to EU countries. See [our FAQ](https://shop.test/faq).', now);
  app.repo.saveLegalText('privacy', 'en', '# Privacy\n\nWe keep orders for 3 years.', now);
  assert.deepEqual(liveProblems(app.ctx), []);
  assert.match(await app.get('/deals/lamp-1?lang=en'), /action="\/deals\/lamp-1\/join"/);
  assert.match(await app.get('/admin', app.auth), /Live: real payments/);
  assert.match(await app.get('/admin/go-live', app.auth), /taking orders/);
});

test('webhooks from the other Stripe mode are refused', async (t) => {
  const live = await startApp();
  t.after(live.close);
  const send = (app, livemode) => fetch(`${app.url}/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 'x' }, body: JSON.stringify({ id: `evt_${Math.random()}`, type: 'payment_intent.succeeded', livemode }) });
  assert.equal((await send(live, false)).status, 400);
  assert.equal((await send(live, true)).status, 200);
  const testShop = await startApp({ live: false });
  t.after(testShop.close);
  assert.equal((await send(testShop, true)).status, 400);
  assert.equal((await send(testShop, false)).status, 200);
  assert.match(await testShop.get('/admin', testShop.auth), /Test mode: no real payments/);
  assert.equal(goLiveChecks(testShop.ctx).find((c) => c.label === 'Payments').ok, false);
});
