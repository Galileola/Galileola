import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDb, createRepo } from '../src/db.js';
import { createEngine } from '../src/engine.js';
import { createMailer } from '../src/mailer.js';
import { createPhotoStore } from '../src/photos.js';
import { allRoutes } from '../src/routes/index.js';
import { render } from '../src/emails.js';
import { anonymise } from '../src/privacy.js';
import { randomToken } from '../src/util.js';
import { createFakeStripe } from './support/fakeStripe.js';
import { adminLogin } from './support/admin.js';

// The online withdrawal function (Article 11a of Directive 2011/83/EU): "Withdraw from contract
// here" on every page, the statement, "Confirm withdrawal", and the acknowledgement with its content
// and the date and time.

async function startShop() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-withdraw-'));
  const config = {
    port: 0, baseUrl: 'https://shop.test', adminUser: 'admin', adminPassword: 'secret-pw', appSecret: 'test-secret-0123456789abcdef',
    stripePublishableKey: 'pk_test_1', defaultTaxCode: 'txcd_99999999', uploadDir: path.join(dir, 'uploads'), trustProxy: false,
    quietEmails: true, contentLanguage: 'en',
    business: { name: 'Test Shop OÜ', address: 'Narva mnt 5, Tallinn', email: 'shop@example.com', phone: '+372 5555 5555', vatId: 'EE1', registration: 'R1', supervisoryAuthority: 'DPA' },
  };
  const repo = createRepo(openDb(path.join(dir, 'db.sqlite')));
  const ctx = { config, repo, clock: { now: () => new Date() }, stripe: createFakeStripe(), photos: createPhotoStore(config.uploadDir), routes: allRoutes };
  ctx.mailer = createMailer(ctx);
  ctx.engine = createEngine(ctx);
  const server = createApp(ctx).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const deal = repo.insertDeal({ slug: 'oak-lamp-1', product_name: 'Oak lamp', description: '', image_url: '', price_cents: 4900, tax_code: 'txcd_99999999', min_buyers: 2, deadline: new Date(Date.now() + 2 * 86400000).toISOString(), created_at: new Date().toISOString() });
  const buyer = (email, status, lang = 'en') => {
    const p = repo.insertParticipant({ deal_id: deal.id, token: randomToken(), email, name: 'Anna Tamm', address_line1: 'S 1', address_line2: '', postal_code: '1', city: 'C', country: 'EE', lang, terms_accepted_at: new Date().toISOString(), created_at: new Date().toISOString() });
    repo.updateParticipant(p.id, { status, amount_cents: 4900 }, new Date().toISOString());
    return repo.participantById(p.id);
  };
  const send = (fields) => fetch(`${base}/withdraw`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
  const mails = (kind) => repo.listEmails().filter((e) => e.kind === kind);
  return { base, repo, ctx, deal, buyer, send, mails, close: () => { server.closeAllConnections(); server.close(); } };
}

test('withdraw: "Withdraw from contract here" is in the footer of every page, in the visitor\'s language', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const labels = { en: 'Withdraw from contract here', et: 'Tagane lepingust siin', fi: 'Peru sopimus tästä', lv: 'Atteikties no līguma šeit', ru: 'Отказаться от договора здесь' };
  for (const [lang, label] of Object.entries(labels)) {
    for (const p of ['/', '/deals/oak-lamp-1', '/terms', '/does-not-exist']) {
      const html = await (await fetch(`${shop.base}${p}${p.includes('?') ? '&' : '?'}lang=${lang}`)).text();
      assert.match(html, new RegExp(`<a class="withdraw-link" href="/withdraw">${label}</a>`), `${lang} ${p}`);
    }
  }
  const form = await (await fetch(`${shop.base}/withdraw?lang=en`)).text();
  assert.match(form, /<button type="submit" class="big">Confirm withdrawal<\/button>/);
  for (const field of ['order', 'name', 'email', 'message']) assert.match(form, new RegExp(`name="${field}"`));
  assert.match(form, /<meta name="robots" content="noindex/);
});

test('withdraw: from the buyer\'s own link, an order that was not charged is cancelled at once and acknowledged', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const p = shop.buyer('anna@example.com', 'saved', 'et');
  // The order page and the emails link to the form for this order.
  const done = await (await fetch(`${shop.base}/join/${p.token}/done?lang=et`)).text();
  assert.match(done, new RegExp(`href="/withdraw\\?order=${p.token}">Tagane lepingust siin</a>`));
  const joined = render('joined', { deal: shop.deal, p, baseUrl: 'https://shop.test', business: shop.ctx.config.business, now: new Date() });
  assert.match(joined.body, new RegExp(`Tagane lepingust siin: https://shop\\.test/withdraw\\?order=${p.token}&lang=et`));
  assert.match(joined.body, /\+372 5555 5555/, 'the phone number is in the signature');

  const form = await (await fetch(`${shop.base}/withdraw?order=${p.token}&lang=et`)).text();
  assert.match(form, new RegExp(`Tellimus #${p.id}: Oak lamp`));
  assert.match(form, /value="anna@example\.com"/);
  assert.match(form, /Kinnita taganemine/);

  const res = await shop.send({ order_token: p.token, name: 'Anna Tamm', email: 'anna@example.com', message: 'Muutsin meelt.', lang: 'et' });
  assert.equal(res.status, 200);
  const page = await res.text();
  assert.match(page, /Saime sinu taganemisavalduse kätte/);
  assert.match(page, /Sinu tellimus on tühistatud/);
  assert.match(page, /W-[2-9A-HJ-NP-Z]{6}/);

  assert.equal(shop.repo.participantById(p.id).status, 'withdrawn');
  const [w] = shop.repo.withdrawalsForParticipant(p.id);
  assert.equal(w.status, 'cancelled');
  assert.equal(w.lang, 'et');
  // The acknowledgement: what was sent, and the date and time.
  const [ack] = shop.mails('withdrawalReceived');
  assert.equal(ack.to_addr, 'anna@example.com');
  assert.match(ack.subject, new RegExp(w.reference));
  assert.match(ack.body, /Muutsin meelt\./);
  assert.match(ack.body, new RegExp(`Tellimus: #${p.id} Oak lamp`));
  assert.match(ack.body, /\d{1,2}:\d{2}/, 'with the time');
  assert.match(ack.body, /\b2\d{3}\b/, 'with the date');
  // The shop hears about it; the buyer doesn't get a second "withdrawn" email.
  assert.equal(shop.mails('withdrawalNotice')[0].to_addr, 'shop@example.com');
  assert.equal(shop.mails('withdrawn').length, 0);
});

test('withdraw: a paid order waits for the owner, who refunds it from Admin → Withdrawals', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const p = shop.buyer('ben@example.com', 'paid');
  const res = await shop.send({ order_token: p.token, name: 'Ben', email: 'ben@example.com', lang: 'en' });
  assert.match(await res.text(), /We will refund your payment within 14 days/);
  assert.equal(shop.repo.participantById(p.id).status, 'paid', 'not refunded automatically');
  const [w] = shop.repo.withdrawalsForParticipant(p.id);
  assert.equal(w.status, 'open');

  const auth = await adminLogin(shop.base);
  assert.match(await (await fetch(`${shop.base}/admin`, { headers: auth })).text(), /1 withdrawal to handle/);
  const list = await (await fetch(`${shop.base}/admin/withdrawals`, { headers: auth })).text();
  assert.match(list, new RegExp(w.reference));
  assert.match(list, /Refund in full/);
  const csrf = list.match(/name="_csrf" value="([^"]+)"/)[1];

  // Refunding goes through the engine (it refunds in Stripe and reverses the VAT record).
  const calls = [];
  shop.ctx.engine.withdraw = async (id) => {
    calls.push(id);
    shop.repo.updateParticipant(id, { status: 'withdrawn', refund_id: 're_test' }, new Date().toISOString());
    return shop.repo.participantById(id);
  };
  const refund = await fetch(`${shop.base}/admin/withdrawals/${w.id}/refund`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `_csrf=${csrf}`, redirect: 'manual' });
  assert.equal(refund.status, 303);
  assert.deepEqual(calls, [p.id]);
  assert.equal(shop.repo.withdrawalById(w.id).status, 'done');
  assert.match(decodeURIComponent(refund.headers.get('location')), /refunded in full/);
  assert.doesNotMatch(await (await fetch(`${shop.base}/admin`, { headers: auth })).text(), /withdrawal to handle/);
});

test('withdraw: from the general link nothing is cancelled automatically, even with the order\'s email', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const p = shop.buyer('cleo@example.com', 'saved');
  // Someone who knows Cleo's email can't cancel her order: it waits for the owner.
  const res = await shop.send({ order: 'Oak lamp', name: 'Not Cleo', email: 'cleo@example.com', lang: 'en' });
  assert.match(await res.text(), /We will check which order this is/);
  assert.equal(shop.repo.participantById(p.id).status, 'saved');
  const [w] = shop.repo.withdrawals();
  assert.equal(w.status, 'open');
  assert.equal(w.participant_id, null);
  assert.equal(w.order_text, 'Oak lamp');
  assert.equal(shop.mails('withdrawalReceived').length, 1, 'the statement is acknowledged anyway');
  // A made-up or someone else's token is ignored.
  const forged = await (await fetch(`${shop.base}/withdraw?order=${'x'.repeat(32)}`)).text();
  assert.match(forged, /name="order" /);
});

test('withdraw: the form checks its fields, and bots are ignored', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const bad = await shop.send({ name: '', email: 'nope', order: '', lang: 'en' });
  assert.equal(bad.status, 422);
  const html = await bad.text();
  for (const msg of ['Enter your name.', 'Enter a valid email address for the confirmation.', 'Tell us which order you are withdrawing from.']) assert.match(html, new RegExp(msg));
  const xss = await (await shop.send({ name: '<script>alert(1)</script>', email: 'x', order: '<img src=x onerror=alert(1)>', lang: 'en' })).text();
  assert.doesNotMatch(xss, /<script>alert\(1\)<\/script>|<img src=x/);
  await shop.send({ name: 'Bot', email: 'bot@example.com', order: 'x', website: 'spam.example', lang: 'en' });
  assert.equal(shop.repo.withdrawals().length, 0);
});

test('withdraw: the terms describe the online withdrawal, and erasing a buyer erases their withdrawals', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  for (const lang of ['en', 'et', 'fi', 'lv', 'ru']) {
    const terms = await (await fetch(`${shop.base}/terms?lang=${lang}`)).text();
    assert.match(terms, /<a href="https:\/\/shop\.test\/withdraw">https:\/\/shop\.test\/withdraw<\/a>/, lang);
    assert.match(terms, /\+372 5555 5555/, `${lang}: phone number in the withdrawal instructions`);
  }
  const p = shop.buyer('dan@example.com', 'saved');
  await shop.send({ order_token: p.token, name: 'Dan', email: 'dan@example.com', lang: 'en' });
  await anonymise(shop.ctx, shop.repo.participantById(p.id));
  const [w] = shop.repo.withdrawalsForParticipant(p.id);
  assert.equal(w.name, '');
  assert.equal(w.email, 'erased@invalid');
});
