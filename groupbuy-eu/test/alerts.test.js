import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDb, createRepo } from '../src/db.js';
import { hmac } from '../src/util.js';
import { publicRoutes, matchesSearch } from '../src/routes/public.js';
import { alertRoutes } from '../src/routes/alerts.js';
import { seoRoutes } from '../src/routes/seo.js';
import { adminRoutes } from '../src/routes/admin.js';
import { createPhotoStore } from '../src/photos.js';
import { createMailer } from '../src/mailer.js';
import { anonymiseOldSignups } from '../src/privacy.js';

test('search: every word, any order, without accents or case', () => {
  const deal = { product_name: 'Crème brûlée torch', headline: 'Kitchen gadget', description: 'Refillable butane.' };
  assert.equal(matchesSearch(deal, 'creme'), true);
  assert.equal(matchesSearch(deal, 'TORCH kitchen'), true);
  assert.equal(matchesSearch(deal, 'butane torch'), true);
  assert.equal(matchesSearch(deal, 'torch phone'), false);
  assert.equal(matchesSearch(deal, 'home', 'Home & Kitchen'), true, 'the category name counts');
});

async function startApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-alerts-'));
  let nowMs = Date.now();
  const clock = { now: () => new Date(nowMs) };
  const config = {
    baseUrl: 'https://shop.test', adminUser: 'admin', adminPassword: 'secret-pw', appSecret: 'test-secret-0123456789abcdef',
    defaultTaxCode: 'txcd_99999999', uploadDir: path.join(dir, 'uploads'), trustProxy: false, quietEmails: true, contentLanguage: 'en',
    business: { name: 'Test Shop', address: 'Street 1', email: 'shop@example.com', vatId: 'EE1', registration: 'R1', supervisoryAuthority: 'DPA' },
  };
  const repo = createRepo(openDb(path.join(dir, 'db.sqlite')));
  const sent = [];
  const transport = { sendMail: async (m) => sent.push(m) };
  const ctx = { config: { ...config, smtpUrl: 'smtp://x' }, repo, clock, photos: createPhotoStore(config.uploadDir), routes: [seoRoutes, publicRoutes, alertRoutes, adminRoutes] };
  ctx.mailer = createMailer({ ...ctx, transport });
  const server = createApp(ctx).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:secret-pw').toString('base64') };
  const form = (p, fields, headers = {}) =>
    fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(fields), redirect: 'manual' });
  const admin = (p, fields = {}) => form(p, { _csrf: hmac(config.appSecret, 'admin-csrf'), ...fields }, auth);
  const get = async (p, headers = {}) => (await fetch(base + p, { headers })).text();
  const addDeal = (name, extra = {}) =>
    repo.insertDeal({ slug: `${name.toLowerCase().replace(/\W+/g, '-')}-1`, product_name: name, description: '', image_url: '', price_cents: 4900, tax_code: 'txcd_99999999', min_buyers: 2, deadline: new Date(nowMs + 5 * 86400000).toISOString(), created_at: new Date(nowMs).toISOString(), ...extra });
  return { base, repo, form, admin, get, auth, sent, addDeal, advance: (ms) => { nowMs += ms; }, close: () => server.close() };
}

test('home: deal search keeps the category, says when nothing matches, and is kept out of search engines', async (t) => {
  const app = await startApp();
  t.after(app.close);
  app.addDeal('Oak desk lamp', { category: 'home', headline: 'Warm light' });
  app.addDeal('Trail shoes', { category: 'sports' });
  const all = await app.get('/?lang=en');
  assert.match(all, /role="search"/);
  assert.match(all, /<link rel="canonical"/);
  const found = await app.get('/?lang=en&q=lamp');
  assert.match(found, /Results for “lamp”/);
  assert.match(found, /Oak desk lamp/);
  assert.doesNotMatch(found, /Trail shoes/);
  assert.match(found, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(await app.get('/?lang=en&q=lamp&category=sports'), /No deals match your search/);
  assert.match(await app.get('/?lang=en&category=home&q=warm'), /name="category" value="home"/);
  assert.match(await app.get('/?lang=de&q=xyz'), /Keine Angebote passen zu Ihrer Suche/);
});

test('deal alerts: double opt-in, no duplicates, one-click unsubscribe, and the admin emails a deal', async (t) => {
  const app = await startApp();
  t.after(app.close);
  assert.match(await app.get('/?lang=en'), /id="alerts"[\s\S]*Never miss a deal[\s\S]*name="email"/);

  const bad = await app.form('/alerts', { email: 'not-an-email' });
  assert.equal(bad.status, 422);
  const r = await app.form('/alerts?lang=de', { email: 'Anna@Example.com' }, { 'Accept-Language': 'de' });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Sehen Sie in Ihr Postfach/);
  const sub = app.repo.subscriberByEmail('anna@example.com');
  assert.equal(sub.status, 'pending');
  assert.equal(sub.lang, 'de');
  assert.equal(app.sent.length, 1);
  assert.equal(app.sent[0].subject, 'Bestätigen Sie Ihre Angebotsbenachrichtigungen von Test Shop');
  const confirmLink = app.sent[0].text.match(/https:\/\/shop.test(\/alerts\/confirm\/[\w-]+)/)[1];

  // Asking again within 10 minutes doesn't send another email; a bot filling the hidden field gets nothing.
  await app.form('/alerts', { email: 'anna@example.com' });
  await app.form('/alerts', { email: 'bot@example.com', website: 'http://spam' });
  assert.equal(app.sent.length, 1);
  assert.equal(app.repo.subscriberByEmail('bot@example.com'), undefined);

  assert.match(await app.get(`${confirmLink}?lang=de`), /Sie sind angemeldet/);
  assert.equal(app.repo.subscriberByEmail('anna@example.com').status, 'confirmed');
  assert.match(await app.get('/alerts/confirm/nope'), /no longer valid/);
  // Already confirmed: signing up again says the same and sends nothing.
  await app.form('/alerts', { email: 'anna@example.com' });
  assert.equal(app.sent.length, 1);

  // Admin: list, and email an open deal to confirmed subscribers.
  const list = await app.get('/admin/subscribers', app.auth);
  assert.match(list, /<strong>1<\/strong> confirmed/);
  assert.match(list, /anna@example.com/);
  const deal = app.addDeal('Oak desk lamp', { headline: 'Warm light' });
  assert.match(await app.get(`/admin/deals/${deal.id}`, app.auth), /Email it to 1 subscriber/);
  const announce = await app.admin(`/admin/deals/${deal.id}/announce`);
  assert.match(decodeURIComponent(announce.headers.get('location')), /Emailed to 1 subscriber/);
  const alert = app.sent.at(-1);
  assert.equal(alert.to, 'anna@example.com');
  assert.equal(alert.subject, 'Neues Gruppenangebot: Oak desk lamp');
  assert.match(alert.text, /https:\/\/shop.test\/deals\/oak-desk-lamp-1\?lang=de&utm_source=deal-alert&utm_medium=email/);
  assert.match(alert.text, /Warm light/);
  const unsubscribeUrl = alert.headers['List-Unsubscribe'].slice(1, -1);
  assert.equal(alert.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(app.repo.dealById(deal.id).announced_at);
  assert.match(await app.get(`/admin/deals/${deal.id}`, app.auth), /Sent on/);

  // The link in the email shows a button; the mail app's one-click POST unsubscribes.
  const path = new URL(unsubscribeUrl).pathname;
  assert.match(await app.get(path), /<form method="post" action="\/alerts\/unsubscribe\//);
  assert.equal(app.repo.subscriberByEmail('anna@example.com').status, 'confirmed', 'opening the link alone changes nothing');
  const one = await app.form(path, { 'List-Unsubscribe': 'One-Click' });
  assert.equal(one.status, 200);
  assert.equal(app.repo.subscriberByEmail('anna@example.com').status, 'unsubscribed');
  assert.match(await app.get(path), /You(&#39;|')re unsubscribed/);

  // Signing up again starts a new confirmation with a new link.
  await app.form('/alerts', { email: 'anna@example.com' });
  const again = app.repo.subscriberByEmail('anna@example.com');
  assert.equal(again.status, 'pending');
  assert.notEqual(again.token, sub.token);

  // Unconfirmed sign-ups are deleted after 30 days.
  app.advance(31 * 86400000);
  await anonymiseOldSignups({ repo: app.repo, clock: { now: () => new Date(Date.now() + 31 * 86400000) } });
  assert.equal(app.repo.subscriberByEmail('anna@example.com'), undefined);
  assert.match(await app.get('/robots.txt'), /Disallow: \/alerts\//);
});

test('deal alerts: too many sign-ups from one address are refused', async (t) => {
  const app = await startApp();
  t.after(app.close);
  for (let i = 0; i < 5; i++) assert.equal((await app.form('/alerts', { email: `p${i}@example.com` })).status, 200);
  assert.equal((await app.form('/alerts', { email: 'p9@example.com' })).status, 429);
});
