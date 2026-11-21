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
import { cleanTracking, parseTrackingLines, validateMessage } from '../src/fulfilment.js';

const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

test('tracking input and pasted tracking lines', () => {
  assert.deepEqual(cleanTracking({ tracking: '  JJD 0003 ', url: 'dhl.de/track?id=1' }), { number: 'JJD 0003', link: 'https://dhl.de/track?id=1' });
  assert.match(cleanTracking({ url: 'javascript:alert(1)' }).error, /tracking link/);
  const { rows, errors } = parseTrackingLines('participant_id,tracking\n12, AB123, https://t.test/AB123\n#13;CD456\n\nfoo,1\n14\tEF789');
  assert.deepEqual(rows, [
    { id: 12, tracking: 'AB123', url: 'https://t.test/AB123' },
    { id: 13, tracking: 'CD456', url: '' },
    { id: 14, tracking: 'EF789', url: '' },
  ]);
  assert.deepEqual(errors, ['Line 5: "foo" is not an order number.']);
  assert.deepEqual(validateMessage({ subject: ' Delivery ', body: 'Next week.\r\nThanks', audience: 'paid' }), { errors: {}, message: { subject: 'Delivery', body: 'Next week.\nThanks' }, audience: 'paid' });
  assert.ok(validateMessage({ subject: '', body: '' }).errors.subject);
});

async function startApp({ assistant = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-fulfil-'));
  const config = {
    baseUrl: 'https://shop.test', adminUser: 'admin', adminPassword: 'secret-pw', appSecret: 'test-secret-0123456789abcdef',
    defaultTaxCode: 'txcd_99999999', uploadDir: path.join(dir, 'uploads'), trustProxy: false, quietEmails: true, contentLanguage: 'en',
    business: { name: 'Test Shop', address: 'Street 1', email: 'shop@example.com', vatId: 'EE1', registration: 'R1', supervisoryAuthority: 'DPA' },
  };
  const repo = createRepo(openDb(path.join(dir, 'db.sqlite')));
  const ctx = { config, repo, clock: systemClock, assistant, photos: createPhotoStore(config.uploadDir), routes: [publicRoutes, adminRoutes] };
  ctx.mailer = createMailer(ctx);
  const server = createApp(ctx).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:secret-pw').toString('base64') };
  const post = (p, fields = {}) =>
    fetch(base + p, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: hmac(config.appSecret, 'admin-csrf'), ...fields }), redirect: 'manual' });
  const deal = repo.insertDeal({ slug: 'lamp-1', product_name: 'Oak lamp', description: '', image_url: '', price_cents: 4900, tax_code: 'txcd_99999999', min_buyers: 2, deadline: inDays(3), created_at: new Date().toISOString() });
  const buyer = (email, status, lang = 'en') => {
    const p = repo.insertParticipant({ deal_id: deal.id, token: `t-${email}`, email, name: email.split('@')[0], address_line1: 'S 1', address_line2: '', postal_code: '1', city: 'C', country: 'DE', lang, terms_accepted_at: new Date().toISOString(), created_at: new Date().toISOString() });
    repo.updateParticipant(p.id, { status, amount_cents: 4900 }, new Date().toISOString());
    return repo.participantById(p.id);
  };
  const mails = (kind) => repo.listEmails().filter((e) => e.kind === kind);
  return { base, auth, repo, deal, buyer, post, mails, close: () => server.close() };
}

test('admin: mark orders as shipped one by one or in bulk; buyers get an email in their language', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const anna = app.buyer('anna@example.com', 'paid', 'de');
  const ben = app.buyer('ben@example.com', 'processing');
  const cleo = app.buyer('cleo@example.com', 'paid');
  const dan = app.buyer('dan@example.com', 'saved');

  const page = await (await fetch(`${app.base}/admin/deals/${app.deal.id}`, { headers: app.auth })).text();
  assert.match(page, /<strong>0<\/strong> of 3 paid orders shipped/);
  assert.match(page, /Mark all 3 as shipped/);

  const r = await app.post(`/admin/participants/${anna.id}/ship`, { tracking: 'JJD123', url: 'https://dhl.test/JJD123' });
  assert.equal(r.status, 303);
  const shipped = app.repo.participantById(anna.id);
  assert.ok(shipped.shipped_at);
  assert.equal(shipped.tracking_number, 'JJD123');
  const [mail] = app.mails('shipped');
  assert.equal(mail.to_addr, 'anna@example.com');
  assert.equal(mail.subject, 'Ihre Bestellung ist unterwegs: Oak lamp');
  assert.match(mail.body, /Sendungsnummer: JJD123/);
  assert.match(mail.body, /Sendung verfolgen: https:\/\/dhl.test\/JJD123/);

  const refused = await app.post(`/admin/participants/${dan.id}/ship`, {});
  assert.match(decodeURIComponent(refused.headers.get('location')), /Only paid orders/);

  const bulk = await app.post(`/admin/deals/${app.deal.id}/ship-bulk`, { lines: `${ben.id}, ZZ9, \n${dan.id}, X\n999, Y` });
  const flash = decodeURIComponent(bulk.headers.get('location'));
  assert.match(flash, /1 order marked as shipped/);
  assert.match(flash, new RegExp(`#${dan.id} is not a paid order`));
  assert.equal(app.repo.participantById(ben.id).tracking_number, 'ZZ9');

  await app.post(`/admin/deals/${app.deal.id}/ship-bulk`, { all: '1' });
  assert.ok(app.repo.participantById(cleo.id).shipped_at);
  assert.equal(app.mails('shipped').length, 3, 'nobody is emailed twice');

  await app.post(`/admin/participants/${cleo.id}/unship`);
  assert.equal(app.repo.participantById(cleo.id).shipped_at, null);

  const csv = await (await fetch(`${app.base}/admin/deals/${app.deal.id}/orders.csv`, { headers: app.auth })).text();
  assert.match(csv, /"shipped_at","tracking_number","tracking_url"/);
  assert.match(csv, /"JJD123","https:\/\/dhl.test\/JJD123"/);
});

test('admin: message the buyers, translated by the AI when it is on', async (t) => {
  const asked = [];
  const assistant = {
    reply: async ({ system, messages }) => {
      asked.push(system);
      const m = JSON.parse(messages[0].content);
      return { text: JSON.stringify({ subject: `DE: ${m.subject}`, body: `DE: ${m.body}` }) };
    },
  };
  const app = await startApp({ assistant });
  t.after(app.close);
  app.buyer('anna@example.com', 'paid', 'de');
  app.buyer('ben@example.com', 'saved');
  app.buyer('gone@example.com', 'released');

  const bad = await app.post(`/admin/deals/${app.deal.id}/message`, { subject: '', body: '' });
  assert.match(decodeURIComponent(bad.headers.get('location')), /Write a subject/);

  const r = await app.post(`/admin/deals/${app.deal.id}/message`, { subject: 'Delivery next week', body: 'The lamps arrive on Monday.', audience: 'all' });
  assert.match(decodeURIComponent(r.headers.get('location')), /Message sent to 2 buyers/);
  const sent = app.mails('message');
  assert.deepEqual(sent.map((m) => m.to_addr).sort(), ['anna@example.com', 'ben@example.com']);
  const anna = sent.find((m) => m.to_addr === 'anna@example.com');
  assert.equal(anna.subject, 'DE: Delivery next week');
  assert.match(anna.body, /^Hallo anna,/);
  assert.match(anna.body, /DE: The lamps arrive on Monday\./);
  assert.match(anna.body, /Sie erhalten diese E-Mail, weil Sie beim Gruppenangebot für Oak lamp mitmachen\./);
  const ben = sent.find((m) => m.to_addr === 'ben@example.com');
  assert.equal(ben.subject, 'Delivery next week');
  assert.equal(asked.length, 1, 'one translation per language');

  await app.post(`/admin/deals/${app.deal.id}/message`, { subject: 'Paid only', body: 'Thanks!', audience: 'paid' });
  assert.deepEqual(app.mails('message').filter((m) => m.subject.includes('Paid only')).map((m) => m.to_addr), ['anna@example.com']);
});
