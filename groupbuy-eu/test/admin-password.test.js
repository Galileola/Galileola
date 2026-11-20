import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, createRepo } from '../src/db.js';
import { createApp } from '../src/app.js';
import { adminRoutes } from '../src/routes/admin.js';
import { hashPassword, verifyPassword } from '../src/adminPassword.js';
import { hmac, systemClock } from '../src/util.js';

test('hash and verify', () => {
  const h = hashPassword('correct horse battery');
  assert.match(h, /^scrypt\$/);
  assert.equal(h.includes('correct horse'), false);
  assert.equal(verifyPassword('correct horse battery', h), true);
  assert.equal(verifyPassword('wrong', h), false);
});

async function start(adminPassword, dbFile) {
  const config = {
    baseUrl: 'http://localhost', adminUser: 'admin', adminPassword, appSecret: 'test-secret-0123456789abcdef',
    defaultTaxCode: 'txcd_99999999', uploadDir: path.join(path.dirname(dbFile), 'uploads'), trustProxy: false,
    business: { name: 'Shop', address: 'A', email: 'a@b.c', vatId: 'V', registration: 'R', supervisoryAuthority: 'D' },
  };
  const repo = createRepo(openDb(dbFile));
  const server = createApp({ config, repo, clock: systemClock, routes: [adminRoutes] }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = (pass) => ({ Authorization: 'Basic ' + Buffer.from(`admin:${pass}`).toString('base64') });
  const csrf = hmac(config.appSecret, 'admin-csrf');
  const change = (pass, fields) =>
    fetch(`${base}/admin/password`, {
      method: 'POST',
      headers: { ...login(pass), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, ...fields }),
    });
  return { base, login, change, close: () => server.close() };
}

test('change the admin password in the admin; Hostinger ADMIN_PASSWORD can reset it', async (t) => {
  const db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gb-pw-')), 'db.sqlite');
  const a = await start('the-old-password-123', db);
  t.after(a.close);

  assert.equal((await fetch(`${a.base}/admin/password`, { headers: a.login('the-old-password-123') })).status, 200);

  let r = await a.change('the-old-password-123', { current_password: 'nope', new_password: 'brand-new-pass-456', repeat_password: 'brand-new-pass-456' });
  assert.equal(r.status, 422);
  assert.match(await r.text(), /current password is not right/);

  r = await a.change('the-old-password-123', { current_password: 'the-old-password-123', new_password: 'short', repeat_password: 'short' });
  assert.match(await r.text(), /at least 12 characters/);

  r = await a.change('the-old-password-123', { current_password: 'the-old-password-123', new_password: 'brand-new-pass-456', repeat_password: 'brand-new-pass-457' });
  assert.match(await r.text(), /match/);

  r = await a.change('the-old-password-123', { current_password: 'the-old-password-123', new_password: 'brand-new-pass-456', repeat_password: 'brand-new-pass-456' });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Password changed/);

  assert.equal((await fetch(`${a.base}/admin`, { headers: a.login('the-old-password-123') })).status, 401);
  assert.equal((await fetch(`${a.base}/admin`, { headers: a.login('brand-new-pass-456') })).status, 200);
  const stored = fs.readFileSync(db).toString('latin1');
  assert.equal(stored.includes('brand-new-pass-456'), false); // only the hash is stored
  a.close();

  // Restart with the same ADMIN_PASSWORD: the changed password still applies.
  const b = await start('the-old-password-123', db);
  assert.equal((await fetch(`${b.base}/admin`, { headers: b.login('brand-new-pass-456') })).status, 200);
  assert.equal((await fetch(`${b.base}/admin`, { headers: b.login('the-old-password-123') })).status, 401);
  b.close();

  // A new ADMIN_PASSWORD set in Hostinger takes over (the "forgot my password" way back).
  const c = await start('reset-from-hostinger-789', db);
  t.after(c.close);
  assert.equal((await fetch(`${c.base}/admin`, { headers: c.login('reset-from-hostinger-789') })).status, 200);
  assert.equal((await fetch(`${c.base}/admin`, { headers: c.login('brand-new-pass-456') })).status, 401);
});
