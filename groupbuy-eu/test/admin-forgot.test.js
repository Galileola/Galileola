import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDb, createRepo } from '../src/db.js';
import { createMailer } from '../src/mailer.js';
import { adminRoutes } from '../src/routes/admin.js';
import { createPhotoStore } from '../src/photos.js';
import { maskEmail, resetAddress } from '../src/passwordReset.js';
import { adminLogin } from './support/admin.js';

async function startApp({ smtp = true, adminEmail = '', businessEmail = 'owner@shop.test', adminPassword = 'secret-pw' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-forgot-'));
  let nowMs = 1_800_000_000_000;
  const clock = { now: () => new Date(nowMs) };
  const config = {
    baseUrl: 'https://shop.test', adminUser: 'admin', adminPassword, adminEmail, appSecret: 'test-secret-0123456789abcdef',
    defaultTaxCode: 'txcd_99999999', uploadDir: path.join(dir, 'uploads'), trustProxy: false, smtpUrl: smtp ? 'smtp://x' : '', quietEmails: true,
    business: { name: 'SEK Deals', address: 'A', email: businessEmail, vatId: 'EE1', registration: 'R', supervisoryAuthority: 'D', phone: '+372 5555 5555' },
  };
  const repo = createRepo(openDb(path.join(dir, 'db.sqlite')));
  const sent = [];
  const ctx = { config, repo, clock, photos: createPhotoStore(config.uploadDir), routes: [adminRoutes] };
  ctx.mailer = createMailer({ ...ctx, transport: smtp ? { sendMail: async (m) => sent.push(m) } : undefined });
  const server = createApp(ctx).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const form = (p, fields) => fetch(base + p, { method: 'POST', body: new URLSearchParams(fields), redirect: 'manual' });
  const canLogIn = async (password) => (await form('/admin/login', { username: 'admin', password })).status === 303;
  const linkIn = (mail) => mail.text.match(/https:\/\/shop\.test(\/admin\/reset\?token=[\w-]+)/)[1];
  return { base, repo, sent, form, canLogIn, linkIn, advance: (ms) => { nowMs += ms; }, close: () => server.close() };
}

test('forgot password: an emailed link sets a new password and logs you in', async (t) => {
  const app = await startApp({ adminPassword: 'current-pass-123' });
  t.after(app.close);
  const otherDevice = await adminLogin(app.base, 'current-pass-123');

  // The login page links to it; the page says where the link goes, without the full address.
  assert.match(await (await fetch(`${app.base}/admin/login`)).text(), /<a href="\/admin\/forgot">Forgot your password\?<\/a>/);
  const page = await (await fetch(`${app.base}/admin/forgot`)).text();
  assert.match(page, /o•••@shop\.test/);
  assert.doesNotMatch(page, /owner@shop\.test/);
  assert.doesNotMatch(page, /aria-label="Admin"/, 'no admin menu');

  const asked = await app.form('/admin/forgot', {});
  assert.equal(asked.status, 200);
  assert.match(await asked.text(), /Email sent to <strong>o•••@shop\.test<\/strong>/);
  assert.equal(app.sent.length, 1);
  assert.equal(app.sent[0].to, 'owner@shop.test');
  assert.match(app.sent[0].subject, /Reset your admin password · SEK Deals/);
  const link = app.linkIn(app.sent[0]);
  // The outbox (readable in the admin and in database backups) doesn't keep the link.
  const outbox = app.repo.listEmails().find((e) => e.kind === 'adminPasswordReset');
  assert.doesNotMatch(outbox.body, /token=/);
  assert.match(outbox.body, /left out of the outbox/);

  // The link opens the form; mail scanners opening it don't use it up.
  for (let i = 0; i < 2; i++) assert.match(await (await fetch(app.base + link)).text(), /Choose a new password/);
  const token = link.split('token=')[1];
  const choose = (new_password, repeat_password = new_password) => app.form('/admin/reset', { token, new_password, repeat_password });
  assert.match(await (await choose('short')).text(), /at least 12 characters/);
  assert.match(await (await choose('brand-new-pass-456', 'brand-new-pass-457')).text(), /match/);
  assert.match(await (await choose('current-pass-123')).text(), /already your password/);

  const done = await choose('brand-new-pass-456');
  assert.equal(done.status, 303);
  assert.match(decodeURIComponent(done.headers.get('location')), /^\/admin\?flash=Your new password is saved/);
  const cookie = done.headers.getSetCookie().find((c) => c.startsWith('gb_admin=')).split(';')[0];
  assert.equal((await fetch(`${app.base}/admin`, { headers: { Cookie: cookie } })).status, 200, 'logged in');
  assert.equal((await fetch(`${app.base}/admin`, { headers: otherDevice, redirect: 'manual' })).status, 303, 'other devices logged out');
  assert.equal(await app.canLogIn('brand-new-pass-456'), true);
  assert.equal(await app.canLogIn('current-pass-123'), false);

  // The link works once.
  const again = await fetch(app.base + link);
  assert.equal(again.status, 410);
  assert.match(await again.text(), /This link no longer works/);
  assert.equal((await choose('another-new-pass-789')).status, 410);
  assert.equal(await app.canLogIn('brand-new-pass-456'), true);
});

test('forgot password: links expire after 30 minutes, and only the newest one works', async (t) => {
  const app = await startApp();
  t.after(app.close);
  await app.form('/admin/forgot', {});
  const first = app.linkIn(app.sent[0]);
  await app.form('/admin/forgot', {});
  const second = app.linkIn(app.sent[1]);
  assert.equal((await fetch(app.base + first)).status, 410, 'replaced by the newer link');
  assert.equal((await fetch(app.base + second)).status, 200);
  app.advance(31 * 60_000);
  assert.equal((await fetch(app.base + second)).status, 410, 'expired');
  for (const bad of ['', 'x', 'a'.repeat(500), '../../etc']) {
    assert.equal((await fetch(`${app.base}/admin/reset?token=${encodeURIComponent(bad)}`)).status, 410);
  }

  // A password changed another way (here: in the admin) also ends a pending link.
  await app.form('/admin/forgot', {});
  const pending = app.linkIn(app.sent[2]);
  const auth = await adminLogin(app.base);
  const { hmac } = await import('../src/util.js');
  await fetch(`${app.base}/admin/password`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: hmac('test-secret-0123456789abcdef', 'admin-csrf'), current_password: 'secret-pw', new_password: 'changed-in-admin-1', repeat_password: 'changed-in-admin-1' }),
  });
  assert.equal((await fetch(app.base + pending)).status, 410);
});

test('forgot password: at most 3 emails per visitor every 15 minutes', async (t) => {
  const app = await startApp();
  t.after(app.close);
  for (let i = 0; i < 3; i++) assert.equal((await app.form('/admin/forgot', {})).status, 200);
  const limited = await app.form('/admin/forgot', {});
  assert.equal(limited.status, 429);
  assert.match(await limited.text(), /Too many reset emails/);
  assert.equal(app.sent.length, 3);
  app.advance(15 * 60_000 + 1000);
  assert.equal((await app.form('/admin/forgot', {})).status, 200);
});

test('forgot password: ADMIN_EMAIL wins; without email the page explains the hosting-panel way', async (t) => {
  assert.equal(resetAddress({ adminEmail: 'me@admin.test', business: { email: 'shop@shop.test' } }), 'me@admin.test');
  assert.equal(resetAddress({ adminEmail: '', business: { email: 'shop@shop.test' } }), 'shop@shop.test');
  assert.equal(resetAddress({ adminEmail: '', business: { email: '[contact@example.com]' } }), '', 'a placeholder is no address');
  assert.equal(resetAddress({ adminEmail: 'not an email', business: { email: '' } }), '');
  assert.equal(maskEmail('anna@example.com'), 'a•••@example.com');

  const viaAdminEmail = await startApp({ adminEmail: 'me@admin.test' });
  t.after(viaAdminEmail.close);
  await viaAdminEmail.form('/admin/forgot', {});
  assert.equal(viaAdminEmail.sent[0].to, 'me@admin.test');

  const noSmtp = await startApp({ smtp: false });
  t.after(noSmtp.close);
  const page = await (await fetch(`${noSmtp.base}/admin/forgot`)).text();
  assert.match(page, /can't send emails yet/);
  assert.match(page, /ADMIN_PASSWORD/);
  assert.doesNotMatch(page, /Email me a reset link/);
  assert.equal((await noSmtp.form('/admin/forgot', {})).status, 422);
  assert.equal(noSmtp.repo.listEmails().length, 0, 'nothing sent or stored');

  const noAddress = await startApp({ businessEmail: '[contact@example.com]' });
  t.after(noAddress.close);
  assert.match(await (await fetch(`${noAddress.base}/admin/forgot`)).text(), /no email address to send a reset link to/);
  assert.equal((await noAddress.form('/admin/forgot', {})).status, 422);
  assert.equal(noAddress.sent.length, 0);
});
