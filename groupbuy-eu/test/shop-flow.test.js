import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Stripe from 'stripe';
import { createApp } from '../src/app.js';
import { openDb, createRepo } from '../src/db.js';
import { createEngine } from '../src/engine.js';
import { createMailer } from '../src/mailer.js';
import { createPhotoStore } from '../src/photos.js';
import { allRoutes } from '../src/routes/index.js';
import { createFakeStripe } from './support/fakeStripe.js';

// A buyer's whole visit through the real pages: deal page → join form → payment page → back from
// Stripe → "You're in", then the minimum is reached, a webhook arrives and the "fix your payment"
// page is used. Stripe itself is the in-memory fake; webhook signatures use the real Stripe library.
const WEBHOOK_SECRET = 'whsec_test_secret';

async function startShop() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-flow-'));
  const config = {
    port: 0, baseUrl: 'https://shop.test', adminUser: 'admin', adminPassword: 'secret-pw', appSecret: 'test-secret-0123456789abcdef',
    stripePublishableKey: 'pk_test_123', stripeWebhookSecret: WEBHOOK_SECRET, defaultTaxCode: 'txcd_99999999',
    uploadDir: path.join(dir, 'uploads'), trustProxy: false, quietEmails: true, joinRateLimit: 50, contentLanguage: 'en',
    business: { name: 'Test Shop', address: 'Street 1', email: 'shop@example.com', vatId: 'EE1', registration: 'R1', supervisoryAuthority: 'DPA', phone: '+372 5555 5555' },
  };
  const repo = createRepo(openDb(path.join(dir, 'db.sqlite')));
  const stripe = createFakeStripe();
  const real = new Stripe('sk_test_dummy');
  stripe.webhooks = real.webhooks;
  const ctx = { config, repo, clock: { now: () => new Date() }, stripe, photos: createPhotoStore(config.uploadDir), routes: allRoutes };
  ctx.mailer = createMailer(ctx);
  ctx.engine = createEngine(ctx);
  const server = createApp(ctx).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const deal = repo.insertDeal({ slug: 'oak-lamp-1', product_name: 'Oak lamp', description: 'Warm light.', image_url: '', price_cents: 4900, tax_code: 'txcd_99999999', min_buyers: 2, deadline: new Date(Date.now() + 2 * 86400000).toISOString(), created_at: new Date().toISOString() });
  const signed = (event) => {
    const payload = JSON.stringify(event);
    return { payload, header: real.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }) };
  };
  return { base, repo, stripe, ctx, deal, signed, close: () => server.close() };
}

const joinForm = (email, extra = {}) =>
  new URLSearchParams({ name: 'Anna Tamm', email, address_line1: 'Narva mnt 5', address_line2: '', postal_code: '10117', city: 'Tallinn', country: 'EE', accept_terms: 'yes', lang: 'en', ...extra });

test('a buyer joins through the real pages, and the "fix your payment" page works', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const deal = await (await fetch(`${shop.base}/deals/oak-lamp-1?lang=en`)).text();
  assert.match(deal, /action="\/deals\/oak-lamp-1\/join"/);
  assert.match(deal, /0 of 2 buyers joined|<span class="counter-num" data-count>0<\/span>/);

  // Missing fields are shown, nothing is created.
  const bad = await fetch(`${shop.base}/deals/oak-lamp-1/join`, { method: 'POST', body: joinForm('not-an-email', { accept_terms: '' }), redirect: 'manual' });
  assert.equal(bad.status, 422);
  assert.equal(shop.repo.participantsForDeal(shop.deal.id).length, 0);

  const join = await fetch(`${shop.base}/deals/oak-lamp-1/join`, { method: 'POST', body: joinForm('anna@example.com'), redirect: 'manual' });
  assert.equal(join.status, 303);
  const payPage = join.headers.get('location');
  assert.match(payPage, /^\/join\/[\w-]+$/);
  const page = await fetch(shop.base + payPage);
  const html = await page.text();
  assert.match(html, /<script src="https:\/\/js.stripe.com\/v3\/"><\/script>/, 'Stripe.js only on payment pages');
  assert.match(html, /seti_secret_/);
  assert.match(html, /pk_test_123/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);

  const p = shop.repo.participantsForDeal(shop.deal.id)[0];
  assert.equal(p.tax_rate_label, '22% VAT EE');
  shop.stripe._completeSetup(p.setup_intent_id, 'card_sca');
  // Stripe sends the buyer back; the setup_intent in the address is ignored, the saved one is used.
  const back = await fetch(`${shop.base}${payPage}/complete?setup_intent=seti_someone_else`, { redirect: 'manual' });
  assert.equal(back.headers.get('location'), `${payPage}/done`);
  assert.match(await (await fetch(`${shop.base}${payPage}/done?lang=en`)).text(), /Nothing has been charged/);
  assert.equal(shop.repo.participantById(p.id).status, 'saved');

  // The second buyer completes the minimum (via the webhook this time).
  await fetch(`${shop.base}/deals/oak-lamp-1/join`, { method: 'POST', body: joinForm('ben@example.com', { name: 'Ben' }), redirect: 'manual' });
  const ben = shop.repo.participantByEmail(shop.deal.id, 'ben@example.com');
  shop.stripe._completeSetup(ben.setup_intent_id, 'card_ok');
  const { payload, header } = shop.signed(shop.stripe._event('setup_intent.succeeded', { id: ben.setup_intent_id }));
  const hook = await fetch(`${shop.base}/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header }, body: payload });
  assert.equal(hook.status, 200);
  await shop.ctx.engine.idle();
  assert.equal(shop.repo.dealById(shop.deal.id).status, 'charging');
  assert.equal(shop.repo.participantById(ben.id).status, 'paid');
  // Anna's bank wants 3-D Secure: she gets the link and pays on the page.
  const anna = shop.repo.participantById(p.id);
  assert.equal(anna.status, 'failed');
  assert.equal(anna.needs_authentication, 1);
  const fix = await (await fetch(`${shop.base}/pay/${anna.token}?lang=en`)).text();
  assert.match(fix, /pi_secret_/);
  shop.stripe._payOnSession(anna.payment_intent_id);
  const done = await fetch(`${shop.base}/pay/${anna.token}/complete`, { redirect: 'manual' });
  assert.equal(done.headers.get('location'), `/join/${anna.token}/done`);
  assert.equal(shop.repo.participantById(p.id).status, 'paid');

  // Forged webhooks and unknown links are refused.
  const forged = await fetch(`${shop.base}/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=bad' }, body: payload });
  assert.equal(forged.status, 400);
  assert.equal((await fetch(`${shop.base}/join/not-a-token`)).status, 404);
  assert.equal((await fetch(`${shop.base}/pay/not-a-token`)).status, 404);
  // Joining again with the same email is refused politely.
  const again = await fetch(`${shop.base}/deals/oak-lamp-1/join`, { method: 'POST', body: joinForm('ben@example.com'), redirect: 'manual' });
  assert.equal(again.status, 422);
});
