import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDb, createRepo } from '../src/db.js';
import { hmac } from '../src/util.js';
import { adminRoutes } from '../src/routes/admin.js';
import { createPhotoStore } from '../src/photos.js';

async function startApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-login-'));
  let nowMs = 1_800_000_000_000;
  const clock = { now: () => new Date(nowMs) };
  const config = {
    baseUrl: 'https://shop.test', adminUser: 'admin', adminPassword: 'secret-pw', appSecret: 'test-secret-0123456789abcdef',
    defaultTaxCode: 'txcd_99999999', uploadDir: path.join(dir, 'uploads'), trustProxy: false,
    business: { name: 'SEK Deals', address: 'A', email: 'a@b.ee', vatId: 'EE1', registration: 'R', supervisoryAuthority: 'D', phone: '+372 5555 5555' },
  };
  const repo = createRepo(openDb(path.join(dir, 'db.sqlite')));
  const server = createApp({ config, repo, clock, photos: createPhotoStore(config.uploadDir), routes: [adminRoutes] }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = (fields) =>
    fetch(`${base}/admin/login`, { method: 'POST', body: new URLSearchParams(fields), redirect: 'manual' });
  const sessionCookie = (res) => res.headers.getSetCookie().find((c) => c.startsWith('gb_admin='));
  const open = (p, headers = {}) => fetch(base + p, { headers, redirect: 'manual' });
  return {
    base, repo, login, sessionCookie, open,
    csrf: hmac(config.appSecret, 'admin-csrf'),
    advance: (ms) => { nowMs += ms; },
    close: () => server.close(),
  };
}

test('admin login page: log in, stay logged in, and come back to the page you wanted', async (t) => {
  const app = await startApp();
  t.after(app.close);

  // Logged out: admin pages open the login page and remember where you were going.
  const first = await app.open('/admin/deals/new?copy=3');
  assert.equal(first.status, 303);
  assert.equal(first.headers.get('location'), '/admin/login?next=%2Fadmin%2Fdeals%2Fnew%3Fcopy%3D3');
  const page = await (await app.open('/admin/login?next=%2Fadmin%2Fdeals%2Fnew%3Fcopy%3D3')).text();
  assert.match(page, /Log in to the admin/);
  assert.match(page, /name="next" value="\/admin\/deals\/new\?copy=3"/);
  assert.match(page, /autocomplete="current-password"/);
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
  assert.doesNotMatch(page, /aria-label="Admin"/, 'no admin menu before logging in');
  assert.doesNotMatch(page, new RegExp(app.csrf), "the admin's form token stays behind the login");

  // Wrong password: the page again, with the user name kept.
  const wrong = await app.login({ username: 'admin', password: 'nope', next: '/admin/snap' });
  assert.equal(wrong.status, 401);
  const wrongPage = await wrong.text();
  assert.match(wrongPage, /Wrong user name or password/);
  assert.match(wrongPage, /id="username" name="username" value="admin"/);
  assert.equal(app.sessionCookie(wrong), undefined);
  assert.equal((await app.login({ username: 'someone', password: 'secret-pw' })).status, 401, 'the user name counts too');

  // Right password: back to the page you wanted, with a login cookie.
  const ok = await app.login({ username: 'admin', password: 'secret-pw', next: '/admin/snap' });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/admin/snap');
  const cookie = app.sessionCookie(ok);
  assert.match(cookie, /^gb_admin=[\w-]{40,}; Path=\/admin; HttpOnly; SameSite=Lax; Secure$/, 'ends when the browser closes');
  const auth = { Cookie: cookie.split(';')[0] };
  const admin = await app.open('/admin', auth);
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /<form method="post" action="\/admin\/logout" class="nav-logout">[\s\S]*?🚪 Log out<\/button>/);
  assert.equal((await app.open('/admin/login?next=%2Fadmin%2Fsettings', auth)).headers.get('location'), '/admin/settings', 'already logged in');

  // Only a hash of the login is stored, not the cookie's value.
  const token = auth.Cookie.split('=')[1];
  assert.ok(app.repo.getAdminSetting(`admin_session:${crypto.createHash('sha256').update(token).digest('base64url')}`));
  assert.ok(!app.repo.getAdminSetting(`admin_session:${token}`));
  assert.doesNotMatch(app.repo.getAdminSetting(`admin_session:${crypto.createHash('sha256').update(token).digest('base64url')}`).value, new RegExp(token));

  // A login lasts 12 hours.
  app.advance(11 * 3600_000);
  assert.equal((await app.open('/admin', auth)).status, 200);
  app.advance(2 * 3600_000);
  assert.match((await app.open('/admin', auth)).headers.get('location'), /^\/admin\/login/);

  // "Keep me logged in" lasts 30 days, and survives closing the browser.
  const kept = await app.login({ username: 'admin', password: 'secret-pw', remember: '1' });
  assert.match(app.sessionCookie(kept), /; Max-Age=2592000; Secure$/);
  const keptAuth = { Cookie: app.sessionCookie(kept).split(';')[0] };
  app.advance(29 * 24 * 3600_000);
  assert.equal((await app.open('/admin', keptAuth)).status, 200);
  app.advance(2 * 24 * 3600_000);
  assert.match((await app.open('/admin', keptAuth)).headers.get('location'), /^\/admin\/login/);
});

test('admin: Log out ends the login, even for a copy of the cookie', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const auth = { Cookie: app.sessionCookie(await app.login({ username: 'admin', password: 'secret-pw' })).split(';')[0] };
  const otherDevice = { Cookie: app.sessionCookie(await app.login({ username: 'admin', password: 'secret-pw' })).split(';')[0] };
  const logout = (csrf) =>
    fetch(`${app.base}/admin/logout`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf }),
      redirect: 'manual',
    });

  // Another site can't log you out (no form token).
  assert.equal((await logout('forged')).status, 403);
  assert.equal((await app.open('/admin', auth)).status, 200);

  const out = await logout(app.csrf);
  assert.equal(out.status, 303);
  assert.equal(out.headers.get('location'), '/admin/login?out=1');
  const cleared = out.headers.getSetCookie();
  assert.ok(cleared.some((c) => /^gb_admin=; Path=\/admin; .*Max-Age=0/.test(c)), 'the browser forgets the login');
  assert.ok(cleared.some((c) => /^gb_admin_2fa=; Path=\/admin; .*Max-Age=0/.test(c)), 'and the two-step code');
  assert.match(await (await app.open('/admin/login?out=1')).text(), /You are logged out/);

  // The server ended it too: the same cookie (say, copied from this browser) no longer works.
  assert.match((await app.open('/admin', auth)).headers.get('location'), /^\/admin\/login/);
  assert.equal((await app.open('/admin', otherDevice)).status, 200, 'only this login ends');
});

test('admin: a form sent after the login ended explains it was not saved', async (t) => {
  const app = await startApp();
  t.after(app.close);

  // A script on an admin page (Write with AI, Snap a deal) gets a JSON error it can show.
  const script = await fetch(`${app.base}/admin/ai/description`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ _csrf: app.csrf, product_name: 'Lamp' }),
  });
  assert.equal(script.status, 401);
  const data = await script.json();
  assert.match(data.error, /logged out, so this was not saved/);
  assert.equal(data.errors.form, data.error);

  // A form sent by the browser shows the login page, and comes back to the page it was on.
  const form = await fetch(`${app.base}/admin/business`, {
    method: 'POST',
    headers: { Accept: 'text/html,application/xhtml+xml', Referer: `${app.base}/admin/business`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: app.csrf, name: 'Changed' }),
    redirect: 'manual',
  });
  assert.equal(form.status, 401);
  const html = await form.text();
  assert.match(html, /Log in to the admin/);
  assert.match(html, /logged out, so this was not saved/);
  assert.match(html, /name="next" value="\/admin\/business"/);
});

test('admin login: only pages inside the admin are followed, and the old browser prompt is gone', async (t) => {
  const app = await startApp();
  t.after(app.close);
  for (const next of ['//evil.example/admin', 'https://evil.example/admin', '/admin\\@evil.example', '/shop', '']) {
    const r = await app.login({ username: 'admin', password: 'secret-pw', next });
    assert.equal(r.headers.get('location'), '/admin', next);
  }
  const basic = await app.open('/admin', { Authorization: 'Basic ' + Buffer.from('admin:secret-pw').toString('base64') });
  assert.equal(basic.status, 303, 'a password in the browser prompt no longer opens the admin');
  assert.equal(basic.headers.get('www-authenticate'), null, 'and the browser is never asked for one');
});
