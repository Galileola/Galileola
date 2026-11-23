import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createApp } from '../src/app.js';
import { openDb, createRepo } from '../src/db.js';
import { hmac } from '../src/util.js';
import { publicRoutes } from '../src/routes/public.js';
import { adminRoutes, MAX_LOGIN_FAILURES } from '../src/routes/admin.js';
import { createPhotoStore } from '../src/photos.js';
import { anonymiseOldSignups } from '../src/privacy.js';
import { adminLogin } from './support/admin.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);

async function startApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-customers-'));
  let nowMs = Date.now();
  const clock = { now: () => new Date(nowMs) };
  const config = {
    baseUrl: 'https://shop.test', adminUser: 'admin', adminPassword: 'secret-pw', appSecret: 'test-secret-0123456789abcdef',
    defaultTaxCode: 'txcd_99999999', uploadDir: path.join(dir, 'uploads'), trustProxy: false,
    business: { name: 'Test Shop', address: 'Street 1', email: 'shop@example.com', vatId: 'EE1', registration: 'R1', supervisoryAuthority: 'DPA', phone: '+372 5555 5555' },
  };
  const repo = createRepo(openDb(path.join(dir, 'db.sqlite')));
  const deleted = [];
  const stripe = { customers: { del: async (id) => deleted.push(id) } };
  const ctx = { config, repo, clock, stripe, photos: createPhotoStore(config.uploadDir), routes: [publicRoutes, adminRoutes] };
  const server = createApp(ctx).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = await adminLogin(base);
  const csrf = hmac(config.appSecret, 'admin-csrf');
  const get = async (p) => (await fetch(base + p, { headers: auth })).text();
  const post = (p, fields = {}) =>
    fetch(base + p, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, ...fields }), redirect: 'manual' });
  const addDeal = (name) =>
    repo.insertDeal({ slug: `${name}-${Math.random().toString(16).slice(2, 6)}`, product_name: name, description: '', image_url: '', price_cents: 4900, tax_code: 'txcd_99999999', min_buyers: 2, deadline: new Date(nowMs + 86400000).toISOString(), created_at: new Date(nowMs).toISOString() });
  const join = (deal, email, name, status, extra = {}) => {
    const p = repo.insertParticipant({ deal_id: deal.id, token: `t-${Math.random()}`, email, name, address_line1: 'Main St 1', address_line2: '', postal_code: '10111', city: 'Tallinn', country: 'EE', terms_accepted_at: clock.now().toISOString(), created_at: clock.now().toISOString() });
    repo.updateParticipant(p.id, { status, amount_cents: 4900, stripe_customer_id: `cus_${p.id}`, ...extra }, clock.now().toISOString());
    return repo.participantById(p.id);
  };
  return { base, auth, repo, ctx, get, post, addDeal, join, deleted, config, advance: (ms) => { nowMs += ms; }, close: () => server.close() };
}

test('admin: customers by email, search, details and CSV', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const lamp = app.addDeal('Oak lamp');
  const mug = app.addDeal('Mug');
  app.join(lamp, 'Anna@Example.com', 'Anna Tamm', 'paid');
  app.join(mug, 'anna@example.com', 'Anna Tamm', 'released');
  app.join(mug, 'ben@example.com', 'Ben Kask', 'saved');

  const list = await app.get('/admin/customers');
  assert.match(list, /Anna Tamm[\s\S]*anna@example.com[\s\S]*<td class="num">2<\/td>[\s\S]*<td class="num">1<\/td>[\s\S]*€49.00/);
  assert.match(list, /Ben Kask/);
  assert.match(await app.get('/admin'), /href="\/admin\/customers"/);
  const found = await app.get('/admin/customers?q=kask');
  assert.match(found, /Ben Kask/);
  assert.doesNotMatch(found, /Anna Tamm/);
  assert.match(await app.get('/admin/customers?q=%25'), /Nobody matches/, 'a % is searched for literally');

  const person = await app.get('/admin/customers/person?email=anna%40example.com');
  assert.match(person, /Oak lamp[\s\S]*Mug/);
  assert.match(person, /Main St 1, 10111 Tallinn, EE/);
  assert.match(person, /from 1 sign-up that never led to a payment/);

  const csv = await (await fetch(`${app.base}/admin/customers.csv`, { headers: app.auth })).text();
  assert.match(csv, /"email","name","sign_ups","paid_orders","paid_eur"/);
  assert.match(csv, /"anna@example.com","Anna Tamm","2","1","49.00"/);
});

test('erasing a person keeps paid orders; old sign-ups are anonymised automatically', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const deal = app.addDeal('Oak lamp');
  const paid = app.join(deal, 'anna@example.com', 'Anna', 'paid');
  const released = app.join(app.addDeal('Mug'), 'anna@example.com', 'Anna', 'released');
  const r = await app.post('/admin/customers/erase', { email: 'anna@example.com' });
  assert.equal(r.status, 303);
  assert.match(decodeURIComponent(r.headers.get('location')), /1 sign-up anonymised\. 1 paid or active order was kept/);
  const gone = app.repo.participantById(released.id);
  assert.equal(gone.name, '');
  assert.equal(gone.email, `erased-${released.id}@invalid`);
  assert.equal(gone.address_line1, '');
  assert.equal(gone.country, 'EE', 'the country stays for the statistics');
  assert.ok(gone.erased_at);
  assert.notEqual(gone.token, released.token, 'old private links stop working');
  assert.equal(app.repo.participantById(paid.id).name, 'Anna', 'the paid order is kept');
  assert.deepEqual(app.deleted, [`cus_${released.id}`]);

  // Automatic: released or never-finished sign-ups 30 days after they ended.
  const old = app.join(deal, 'old@example.com', 'Old', 'released');
  const withdrawnPaid = app.join(deal, 'refunded@example.com', 'Refunded', 'withdrawn', { paid_at: new Date().toISOString(), refund_id: 're_1' });
  const recent = () => app.join(deal, `new${Math.random()}@example.com`, 'New', 'released');
  app.advance(31 * 86400000);
  const fresh = recent();
  assert.equal(await anonymiseOldSignups(app.ctx), 1);
  assert.equal(app.repo.participantById(old.id).name, '');
  assert.equal(app.repo.participantById(fresh.id).name, 'New', 'ended less than 30 days ago');
  assert.equal(app.repo.participantById(withdrawnPaid.id).name, 'Refunded', 'refunded orders are accounting records');
  assert.equal(app.repo.participantById(paid.id).name, 'Anna');
});

test('admin login: too many wrong passwords lock that address out for 15 minutes', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const login = (password) =>
    fetch(`${app.base}/admin/login`, { method: 'POST', body: new URLSearchParams({ username: 'admin', password }), redirect: 'manual' });
  assert.equal((await login('')).status, 422, 'an empty password: not counted');
  for (let i = 0; i < MAX_LOGIN_FAILURES; i++) assert.equal((await login('nope')).status, 401);
  const locked = await login('secret-pw');
  assert.equal(locked.status, 429, 'even the right password waits');
  assert.match(await locked.text(), /Too many wrong passwords/);
  assert.ok(Number(locked.headers.get('retry-after')) > 800);
  app.advance(15 * 60_000 + 1000);
  assert.equal((await login('secret-pw')).status, 303);
});

test('admin: download every photo as one ZIP', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const photos = createPhotoStore(app.config.uploadDir);
  const names = [photos.save(PNG), photos.save(PNG)];
  const res = await fetch(`${app.base}/admin/photos.zip`, { headers: app.auth });
  assert.equal(res.headers.get('content-type'), 'application/zip');
  const zip = Buffer.from(await res.arrayBuffer());
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt16LE(zip.length - 22 + 10), 2, 'two files');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gb-zip-')), 'photos.zip');
  fs.writeFileSync(file, zip);
  try {
    const listing = execFileSync('unzip', ['-l', file], { encoding: 'utf8' });
    for (const n of names) assert.match(listing, new RegExp(n));
    assert.match(execFileSync('unzip', ['-t', file], { encoding: 'utf8' }), /No errors detected/);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err; // no unzip on this machine: the header checks above stand
  }
});
