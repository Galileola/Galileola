import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDb, createRepo } from '../src/db.js';
import { systemClock, hmac } from '../src/util.js';
import { publicRoutes } from '../src/routes/public.js';
import { adminRoutes } from '../src/routes/admin.js';
import { createPhotoStore } from '../src/photos.js';
import { createMailer } from '../src/mailer.js';
import { createEngine } from '../src/engine.js';
import { validateDealEdit } from '../src/deals.js';
import { adminLogin } from './support/admin.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

test('deal edits: open deals without buyers change freely; buyers lock the price, minimum and earlier deadlines', () => {
  const now = new Date();
  const deal = { status: 'open', price_cents: 4900, min_buyers: 5, tax_code: 'txcd_99999999', deadline: inDays(2) };
  const body = { product_name: 'Lamp', category: 'home', price: '39,00', min_buyers: '3', tax_code: 'txcd_30011000', deadline_iso: inDays(4), seo_title: '  Oak lamp   deal ' };

  const free = validateDealEdit(body, deal, { now, joined: 0 });
  assert.deepEqual(free.errors, {});
  assert.equal(free.changes.price_cents, 3900);
  assert.equal(free.changes.min_buyers, 3);
  assert.equal(free.changes.tax_code, 'txcd_30011000');
  assert.equal(free.changes.seo_title, 'Oak lamp deal');
  assert.ok(free.changes.deadline);

  const joined = validateDealEdit(body, deal, { now, joined: 2 });
  assert.deepEqual(joined.errors, {});
  assert.equal(joined.locked, true);
  assert.equal('price_cents' in joined.changes, false, 'the price stays');
  assert.equal('min_buyers' in joined.changes, false, 'the minimum stays');
  assert.ok(joined.changes.deadline, 'a later deadline is fine');
  assert.match(validateDealEdit({ ...body, deadline_iso: inDays(1) }, deal, { now, joined: 2 }).errors.deadline, /only move later/);
  // The form sends whole minutes: the saved deadline a few seconds off is "unchanged".
  const sameMinute = new Date(new Date(deal.deadline).getTime() - 20_000).toISOString();
  assert.equal('deadline' in validateDealEdit({ ...body, deadline_iso: sameMinute }, deal, { now, joined: 2 }).changes, false);

  const closed = validateDealEdit({ ...body, deadline_iso: '' }, { ...deal, status: 'ready_to_order', deadline: inDays(-3) }, { now, joined: 4 });
  assert.deepEqual(closed.errors, {});
  assert.deepEqual(Object.keys(closed.changes).sort(), ['category', 'description', 'headline', 'image_url', 'product_name', 'seo_description', 'seo_title', 'social_post']);
  assert.match(validateDealEdit({ ...body, product_name: '' }, deal, { now, joined: 0 }).errors.product_name, /name/);
});

async function startApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-deal-admin-'));
  const config = {
    baseUrl: 'https://shop.test', adminUser: 'admin', adminPassword: 'secret-pw', appSecret: 'test-secret-0123456789abcdef',
    defaultTaxCode: 'txcd_99999999', uploadDir: path.join(dir, 'uploads'), trustProxy: false, quietEmails: true, contentLanguage: 'en',
    business: { name: 'Test Shop', address: 'Street 1', email: 'shop@example.com', vatId: 'EE1', registration: 'R1', supervisoryAuthority: 'DPA', phone: '+372 5555 5555' },
  };
  const repo = createRepo(openDb(path.join(dir, 'db.sqlite')));
  const detached = [];
  const stripe = { paymentMethods: { detach: async (id) => detached.push(id) }, setupIntents: { cancel: async () => ({}) } };
  const ctx = { config, repo, clock: systemClock, stripe, photos: createPhotoStore(config.uploadDir), routes: [publicRoutes, adminRoutes] };
  ctx.mailer = createMailer(ctx);
  ctx.engine = createEngine(ctx);
  const server = createApp(ctx).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = await adminLogin(base);
  const csrf = hmac(config.appSecret, 'admin-csrf');
  const get = async (p, headers = auth) => (await fetch(base + p, { headers })).text();
  const post = (p, fields = {}) =>
    fetch(base + p, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, ...fields }),
      redirect: 'manual',
    });
  const addDeal = (fields = {}) =>
    repo.insertDeal({ slug: `lamp-${Math.random().toString(16).slice(2, 8)}`, product_name: 'Oak lamp', description: 'Warm light.', image_url: '', price_cents: 4900, tax_code: 'txcd_99999999', min_buyers: 3, deadline: inDays(3), created_at: new Date().toISOString(), ...fields });
  const addBuyer = (dealId, status = 'saved', email = 'buyer@example.com') => {
    const p = repo.insertParticipant({ deal_id: dealId, token: `tok-${Math.random()}`, email, name: 'Buyer', address_line1: 'Street 1', address_line2: '', postal_code: '10111', city: 'Tallinn', country: 'EE', lang: 'de', terms_accepted_at: new Date().toISOString(), created_at: new Date().toISOString() });
    repo.updateParticipant(p.id, { status, payment_method_id: 'pm_1' }, new Date().toISOString());
    return repo.participantById(p.id);
  };
  return { base, auth, repo, get, post, addDeal, addBuyer, detached, dir, config, close: () => server.close() };
}

test('admin: edit a deal, and its search title shows in the page head', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const deal = app.addDeal();
  assert.match(await app.get(`/admin/deals/${deal.id}`), /href="\/admin\/deals\/\d+\/edit"[\s\S]*Duplicate/);
  const form = await app.get(`/admin/deals/${deal.id}/edit`);
  assert.match(form, /value="Oak lamp"/);
  assert.match(form, /name="price"[^>]*value="49.00"/);
  assert.doesNotMatch(form, /name="price"[^>]*disabled/);

  const r = await app.post(`/admin/deals/${deal.id}/edit`, {
    product_name: 'Solid oak desk lamp', headline: 'Warm and dimmable', description: 'Line one.\r\n\r\nLine two.', category: 'home',
    price: '44.50', min_buyers: '4', tax_code: 'txcd_99999999', deadline_iso: deal.deadline,
    seo_title: 'Oak desk lamp – 10% off together', seo_description: 'Join the group deal for a solid oak desk lamp.',
  });
  assert.equal(r.status, 303);
  const saved = app.repo.dealById(deal.id);
  assert.equal(saved.product_name, 'Solid oak desk lamp');
  assert.equal(saved.description, 'Line one.\n\nLine two.');
  assert.equal(saved.price_cents, 4450);
  assert.equal(saved.min_buyers, 4);
  assert.equal(saved.slug, deal.slug, 'the address stays the same');

  const page = await app.get(`/deals/${deal.slug}`, {});
  assert.match(page, /<title>Oak desk lamp – 10% off together<\/title>/, "the owner's title as it is");
  assert.match(page, /og:title" content="Oak desk lamp – 10% off together"/);
  assert.match(page, /name="description" content="Join the group deal for a solid oak desk lamp."/);

  const bad = await app.post(`/admin/deals/${deal.id}/edit`, { product_name: '', category: 'home', price: 'abc', min_buyers: '4', deadline_iso: deal.deadline });
  assert.equal(bad.status, 422);
  assert.match(await bad.text(), /Enter a product name/);
});

test('admin: once someone has joined, the price and minimum stay', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const deal = app.addDeal();
  app.addBuyer(deal.id);
  const form = await app.get(`/admin/deals/${deal.id}/edit`);
  assert.match(form, /1 buyer has joined/);
  assert.match(form, /name="price"[^>]*disabled/);
  const r = await app.post(`/admin/deals/${deal.id}/edit`, { product_name: 'Oak lamp v2', category: 'home', price: '1.00', min_buyers: '1', deadline_iso: deal.deadline });
  assert.equal(r.status, 303);
  const saved = app.repo.dealById(deal.id);
  assert.equal(saved.product_name, 'Oak lamp v2');
  assert.equal(saved.price_cents, 4900);
  assert.equal(saved.min_buyers, 3);
});

test('admin: cancel releases everyone with a "cancelled" email; delete only works without buyers', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const deal = app.addDeal();
  const buyer = app.addBuyer(deal.id);
  assert.match(await app.get(`/admin/deals/${deal.id}`), /Cancel deal/);
  assert.doesNotMatch(await app.get(`/admin/deals/${deal.id}`), /Delete deal/);

  const refused = await app.post(`/admin/deals/${deal.id}/delete`);
  assert.equal(refused.status, 303);
  assert.ok(app.repo.dealById(deal.id), 'a deal with buyers is never deleted');

  const r = await app.post(`/admin/deals/${deal.id}/cancel`);
  assert.equal(r.status, 303);
  assert.match(decodeURIComponent(r.headers.get('location')), /Deal cancelled/);
  const after = app.repo.dealById(deal.id);
  assert.equal(after.status, 'expired');
  assert.ok(after.cancelled_at);
  assert.equal(app.repo.participantById(buyer.id).status, 'released');
  assert.deepEqual(app.detached, ['pm_1']);
  const mail = app.repo.listEmails().find((e) => e.participant_id === buyer.id);
  assert.equal(mail.subject, 'Angebot abgesagt: Oak lamp', "in the buyer's language");
  assert.match(mail.body, /abgesagt/);
  assert.match(await app.get(`/deals/${deal.slug}?lang=en`, {}), /This deal was cancelled/);

  // A deal nobody joined can be deleted, with its photo files.
  const empty = app.addDeal({ product_name: 'Typo deal' });
  const name = createPhotoStore(app.config.uploadDir).save(PNG);
  app.repo.addPhoto(empty.id, name, new Date().toISOString());
  assert.match(await app.get(`/admin/deals/${empty.id}`), /Delete deal/);
  const del = await app.post(`/admin/deals/${empty.id}/delete`);
  assert.equal(del.status, 303);
  assert.equal(app.repo.dealById(empty.id), undefined);
  assert.equal(fs.existsSync(path.join(app.config.uploadDir, name)), false);
  assert.match(await app.get(`/admin?flash=${encodeURIComponent('Deleted "Typo deal".')}`), /Deleted &#34;Typo deal&#34;/);
});

test('admin: duplicate fills in the new deal form and copies the photos', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const deal = app.addDeal({ headline: 'Warm light', seo_title: 'Oak lamp deal' });
  const photo = createPhotoStore(app.config.uploadDir).save(PNG);
  app.repo.addPhoto(deal.id, photo, new Date().toISOString());
  const form = await app.get(`/admin/deals/new?copy=${deal.id}`);
  assert.match(form, /A copy of "Oak lamp"/);
  assert.match(form, /name="copy_photos_from" value="\d+"/);
  assert.match(form, /id="headline"[^>]*value="Warm light"/);
  assert.match(form, /1 photo will be copied/);

  const body = new FormData();
  for (const [k, v] of Object.entries({ _csrf: hmac(app.config.appSecret, 'admin-csrf'), copy_photos_from: String(deal.id), product_name: 'Oak lamp', headline: 'Warm light', category: 'home', price: '49.00', min_buyers: '3', tax_code: 'txcd_99999999', deadline_iso: inDays(5) })) body.append(k, v);
  const r = await fetch(`${app.base}/admin/deals`, { method: 'POST', headers: app.auth, body, redirect: 'manual' });
  assert.equal(r.status, 303);
  const copy = app.repo.listDeals().find((d) => d.id !== deal.id);
  assert.equal(copy.headline, 'Warm light');
  const photos = app.repo.photosForDeal(copy.id);
  assert.equal(photos.length, 1);
  assert.notEqual(photos[0].filename, photo, 'its own copy of the file');
  assert.ok(fs.existsSync(path.join(app.config.uploadDir, photos[0].filename)));
});
