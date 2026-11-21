import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDb, createRepo } from '../src/db.js';
import { hmac } from '../src/util.js';
import { adminRoutes } from '../src/routes/admin.js';
import { createPhotoStore } from '../src/photos.js';
import { base32Decode, base32Encode, matchTotp, totp, otpauthUrl } from '../src/twoStep.js';

test('codes follow RFC 6238 (the standard authenticator apps use)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(base32Decode(secret).toString(), '12345678901234567890');
  for (const [t, code] of [[59, '94287082'], [1111111109, '07081804'], [1234567890, '89005924'], [2000000000, '69279037']]) {
    assert.equal(totp(secret, t * 1000, { digits: 8 }), code);
  }
  const now = 1_700_000_000_000;
  const code = totp(secret, now);
  const step = Math.floor(now / 30000);
  assert.equal(matchTotp(secret, code, now), step);
  assert.equal(matchTotp(secret, code, now + 30000), step, 'one step late is fine (clock drift)');
  assert.equal(matchTotp(secret, code, now + 90000), null, 'older codes are refused');
  assert.equal(matchTotp(secret, code, now, step), null, 'a used code is refused');
  assert.equal(matchTotp(secret, 'abc', now), null);
  assert.match(otpauthUrl({ secret, issuer: 'SEK Deals', account: 'admin' }), /^otpauth:\/\/totp\/SEK%20Deals%3Aadmin\?secret=GEZD.*&issuer=SEK%20Deals/);
});

async function startApp({ adminTwoStep = 'on' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-2fa-'));
  let nowMs = 1_800_000_000_000;
  const clock = { now: () => new Date(nowMs) };
  const config = {
    baseUrl: 'https://shop.test', adminUser: 'admin', adminPassword: 'secret-pw', appSecret: 'test-secret-0123456789abcdef',
    defaultTaxCode: 'txcd_99999999', uploadDir: path.join(dir, 'uploads'), trustProxy: false, adminTwoStep,
    business: { name: 'SEK Deals', address: 'A', email: 'a@b.ee', vatId: 'EE1', registration: 'R', supervisoryAuthority: 'D' },
  };
  const repo = createRepo(openDb(path.join(dir, 'db.sqlite')));
  const ctx = { config, repo, clock, photos: createPhotoStore(config.uploadDir), routes: [adminRoutes] };
  const server = createApp(ctx).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:secret-pw').toString('base64') };
  const csrf = hmac(config.appSecret, 'admin-csrf');
  let cookie = '';
  const keep = (res) => {
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) if (c.startsWith('gb_admin_2fa=')) cookie = c.split(';')[0];
    return res;
  };
  const get = async (p) => keep(await fetch(base + p, { headers: { ...auth, Cookie: cookie }, redirect: 'manual' }));
  const post = async (p, fields = {}) =>
    keep(await fetch(base + p, { method: 'POST', headers: { ...auth, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, ...fields }), redirect: 'manual' }));
  return {
    repo, ctx, get, post,
    get cookie() { return cookie; },
    forget: () => { cookie = ''; },
    advance: (ms) => { nowMs += ms; },
    code: (secret) => totp(secret, nowMs),
    close: () => server.close(),
  };
}

async function turnOn(app) {
  const start = await app.post('/admin/security/start');
  const page = await start.text();
  assert.match(page, /<svg[^>]*>/, 'QR code');
  const secret = page.match(/<code class="secret">([A-Z2-7 ]+)<\/code>/)[1].replace(/ /g, '');
  assert.equal(secret.length, 32);
  const wrong = await app.post('/admin/security/confirm', { code: '000000' });
  assert.equal(wrong.status, 422);
  const ok = await app.post('/admin/security/confirm', { code: app.code(secret) });
  assert.equal(ok.status, 200);
  const html = await ok.text();
  const backup = [...html.matchAll(/<li><code>([a-z0-9]{4}-[a-z0-9]{4})<\/code><\/li>/g)].map((m) => m[1]);
  assert.equal(backup.length, 10);
  assert.ok(app.cookie, 'this browser stays signed in');
  return { secret, backup };
}

test('two-step login: set up, then every admin page asks for the code once per device', async (t) => {
  const app = await startApp();
  t.after(app.close);
  assert.match(await (await app.get('/admin/security')).text(), /Set up two-step login/);
  assert.match(await (await app.get('/admin/settings')).text(), /Two-step login/);
  const { secret, backup } = await turnOn(app);
  assert.equal((await app.get('/admin')).status, 200);
  assert.match(await (await app.get('/admin')).text(), /🔒 Lock/);

  // Another browser (no cookie): the password alone isn't enough.
  app.forget();
  const r = await app.get('/admin/deals/new?x=1');
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/admin/two-step?next=%2Fadmin%2Fdeals%2Fnew%3Fx%3D1');
  assert.equal((await app.post('/admin/business', { name: 'Hacked' })).status, 303, 'changes need the code too');
  assert.match(await (await app.get('/admin/two-step')).text(), /Enter your code/);

  // The code used during setup can't be used again; the next one can.
  const replay = await app.post('/admin/two-step', { code: app.code(secret), next: '/admin/deals/new' });
  assert.equal(replay.status, 401);
  app.advance(30_000);
  const ok = await app.post('/admin/two-step', { code: app.code(secret), next: '/admin/deals/new' });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/admin/deals/new');
  assert.equal((await app.get('/admin')).status, 200);

  // The device is remembered for 12 hours, or 30 days when ticked.
  app.advance(13 * 3600_000);
  assert.equal((await app.get('/admin')).status, 303);
  const remember = await app.post('/admin/two-step', { code: app.code(secret), remember: '1' });
  assert.match(remember.headers.getSetCookie().join(), /Max-Age=2592000; Secure/);
  app.advance(29 * 24 * 3600_000);
  assert.equal((await app.get('/admin')).status, 200);

  // Lock asks for the code again on this device.
  await app.post('/admin/two-step/lock');
  assert.equal((await app.get('/admin')).status, 303);

  // A backup code works once, and says how many are left.
  const used = await app.post('/admin/two-step', { code: backup[0].toUpperCase() });
  assert.match(decodeURIComponent(used.headers.get('location')), /Backup code used: 9 left/);
  await app.post('/admin/two-step/lock');
  assert.equal((await app.post('/admin/two-step', { code: backup[0] })).status, 401);
  assert.equal((await app.post('/admin/two-step', { code: backup[1] })).status, 303);

  // Only paths inside the admin are followed after the code.
  await app.post('/admin/two-step/lock');
  app.advance(60_000);
  const evil = await app.post('/admin/two-step', { code: app.code(secret), next: '//evil.example/admin' });
  assert.equal(evil.headers.get('location'), '/admin');
});

test('two-step login: wrong codes lock out, new backup codes and turning it off need a code', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const { secret, backup } = await turnOn(app);
  for (let i = 0; i < 5; i++) assert.equal((await app.post('/admin/two-step', { code: '123456' })).status, 401);
  assert.equal((await app.post('/admin/two-step', { code: backup[0] })).status, 429, 'even a right code waits');
  app.advance(16 * 60_000);

  assert.match(await (await app.post('/admin/security/backup-codes', { code: '000000' })).text(), /no new backup codes were made/);
  const fresh = await (await app.post('/admin/security/backup-codes', { code: app.code(secret) })).text();
  assert.match(fresh, /New backup codes made/);
  await app.post('/admin/two-step/lock');
  assert.equal((await app.post('/admin/two-step', { code: backup[0] })).status, 401, 'old backup codes stop working');
  const newCode = fresh.match(/<li><code>([a-z0-9-]{9})<\/code><\/li>/)[1];
  assert.equal((await app.post('/admin/two-step', { code: newCode })).status, 303);

  assert.equal((await app.post('/admin/security/disable', { code: '000000' })).status, 422);
  app.advance(30_000);
  const off = await app.post('/admin/security/disable', { code: app.code(secret) });
  assert.equal(off.status, 303);
  app.forget();
  assert.equal((await app.get('/admin')).status, 200, 'the password alone works again');
  assert.doesNotMatch(await (await app.get('/admin')).text(), /🔒 Lock/);
});

test('ADMIN_TWO_STEP=off in the hosting panel lets the password alone in (lost phone)', async (t) => {
  const app = await startApp();
  t.after(app.close);
  await turnOn(app);
  app.close();
  app.forget();
  // Same database, restarted with ADMIN_TWO_STEP=off.
  const config = { ...app.ctx.config, adminTwoStep: 'off' };
  const server = createApp({ ...app.ctx, config, twoStep: undefined, routes: [adminRoutes] }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const res = await fetch(`http://127.0.0.1:${server.address().port}/admin/security`, { headers: { Authorization: 'Basic ' + Buffer.from('admin:secret-pw').toString('base64') }, redirect: 'manual' });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /switched off in the hosting panel/);
});
