import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Stripe from 'stripe';
import { createApp } from '../src/app.js';
import { openDb, createRepo } from '../src/db.js';
import { createEngine } from '../src/engine.js';
import { createMailer } from '../src/mailer.js';
import { createPhotoStore } from '../src/photos.js';
import { allRoutes } from '../src/routes/index.js';
import { ImageFetchError, downloadImage, isPrivateAddress } from '../src/imageImport.js';
import { renderLegalText } from '../src/legalText.js';
import { goLiveChecks, liveProblems } from '../src/goLive.js';
import { createFakeStripe } from './support/fakeStripe.js';
import { adminLogin } from './support/admin.js';

// Security checks for go-live: the shop is attacked the way an outsider would, through real HTTP
// requests (Stripe is the in-memory fake; webhook signatures use the real Stripe library).
// Run with the other tests (`npm test`) or alone: node --test test/security.test.js

const WEBHOOK_SECRET = 'whsec_test_secret';
const CRON_SECRET = 'cron-secret-0123456789';
const XSS = '"><script>alert(1)</script><img src=x onerror=alert(2)>';

async function startShop() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-security-'));
  const config = {
    port: 0, baseUrl: 'https://shop.test', adminUser: 'admin', adminPassword: 'secret-pw', appSecret: 'test-secret-0123456789abcdef',
    stripePublishableKey: 'pk_test_123', stripeWebhookSecret: WEBHOOK_SECRET, cronSecret: CRON_SECRET, defaultTaxCode: 'txcd_99999999',
    uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'), trustProxy: 1, quietEmails: true, joinRateLimit: 50,
    contentLanguage: 'en', paymentsMode: 'test',
    business: { name: 'Test Shop', address: 'Street 1', email: 'shop@example.com', vatId: 'EE1', registration: 'R1', supervisoryAuthority: 'DPA' },
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
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const deal = repo.insertDeal({
    slug: 'xss-lamp-1', product_name: `Lamp ${XSS}`, description: `Warm ${XSS}`, image_url: '', price_cents: 4900,
    tax_code: 'txcd_99999999', min_buyers: 2, deadline: new Date(Date.now() + 2 * 86400000).toISOString(), created_at: new Date().toISOString(),
  });
  // Raw HTTP, so paths go out exactly as written (fetch would tidy "/a/../b") and Host can be set.
  const raw = (method, rawPath, headers = {}, body = '') =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method, path: rawPath, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      });
      req.on('error', reject);
      req.end(body);
    });
  const csrfFrom = (html) => html.match(/name="_csrf" value="([^"]+)"/)?.[1];
  return { base, repo, stripe, ctx, deal, raw, csrfFrom, real, close: () => server.close() };
}

const form = (obj) => ({ headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(obj) });

test('security: source code, settings, database and backups are never served', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  for (const p of [
    '/.env', '/.env.example', '/.git/config', '/.git/HEAD', '/package.json', '/package-lock.json', '/app.cjs', '/README.md',
    '/src/config.js', '/src/start.js', '/data/groupbuy.sqlite', '/db.sqlite', '/backups/', '/node_modules/express/package.json',
    '/static/../package.json', '/static/%2e%2e/package.json', '/static/..%2f..%2fpackage.json', '/static/%2e%2e%2f%2e%2e%2fsrc/config.js',
    '/uploads/../db.sqlite', '/uploads/..%2fdb.sqlite', '/uploads/%2e%2e/db.sqlite', '/uploads/.htaccess', '/static/js/',
  ]) {
    const r = await shop.raw('GET', p);
    assert.ok(r.status === 404 || r.status === 403 || r.status === 400, `${p} answered ${r.status}`);
    assert.doesNotMatch(r.text, /"dependencies"|STRIPE_SECRET_KEY|SQLite format|export function loadConfig/, `${p} leaked content`);
  }
});

test('security: every admin page and download needs a login', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const gets = [
    '/admin', '/admin/go-live', '/admin/deals/new', `/admin/deals/${shop.deal.id}`, `/admin/deals/${shop.deal.id}/orders.csv`,
    '/admin/backup.sqlite', '/admin/customers', '/admin/customers.csv', '/admin/photos.zip', '/admin/subscribers.csv',
    '/admin/emails', '/admin/settings', '/admin/security', '/admin/password', '/admin/performance', '/admin/import',
    '/admin/legal', '/admin/business', '/admin/branding', '/admin/snap', '/admin/two-step',
  ];
  for (const p of gets) {
    const r = await shop.raw('GET', p);
    assert.equal(r.status, 303, `${p} answered ${r.status} without a login`);
    assert.match(r.headers.location, /^\/admin\/login\?next=/, p);
    assert.doesNotMatch(r.text, /SQLite format|@example\.com/, `${p} leaked data`);
  }
  for (const p of ['/admin/business', `/admin/deals/${shop.deal.id}/delete`, '/admin/customers/erase', '/admin/password', '/admin/tick', '/admin/security/disable']) {
    const r = await shop.raw('POST', p, { 'Content-Type': 'application/x-www-form-urlencoded' }, 'name=Hacked&_csrf=x');
    assert.equal(r.status, 401, `POST ${p} answered ${r.status} without a login`);
  }
  assert.ok(shop.repo.dealById(shop.deal.id), 'the deal is still there');

  // Made-up, malformed and very long session cookies are refused.
  for (const cookie of ['gb_admin=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'gb_admin=../../etc/passwd', 'gb_admin=' + 'a'.repeat(5000), "gb_admin=' OR 1=1 --"]) {
    const r = await shop.raw('GET', '/admin', { Cookie: cookie });
    assert.equal(r.status, 303, `cookie ${cookie.slice(0, 30)} let someone in`);
  }
});

test('security: the session cookie is HttpOnly, SameSite, Secure and ends on the server at logout', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const res = await fetch(`${shop.base}/admin/login`, { method: 'POST', ...form({ username: 'admin', password: 'secret-pw' }), redirect: 'manual' });
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('gb_admin='));
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /Path=\/admin/);
  const headers = { Cookie: setCookie.split(';')[0] };

  // A new login every time: a cookie set before logging in (session fixation) is not reused.
  const second = await fetch(`${shop.base}/admin/login`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'username=admin&password=secret-pw', redirect: 'manual' });
  assert.notEqual(second.headers.getSetCookie().find((c) => c.startsWith('gb_admin='))?.split(';')[0], headers.Cookie);

  const page = await (await fetch(`${shop.base}/admin`, { headers })).text();
  const out = await fetch(`${shop.base}/admin/logout`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `_csrf=${shop.csrfFrom(page)}`, redirect: 'manual' });
  assert.equal(out.status, 303);
  // The copied cookie no longer works after logging out.
  const after = await fetch(`${shop.base}/admin`, { headers, redirect: 'manual' });
  assert.equal(after.status, 303);
  assert.match(after.headers.get('location'), /^\/admin\/login/);
});

test('security: admin forms need the form token (CSRF)', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const headers = await adminLogin(shop.base);
  const send = (body) =>
    fetch(`${shop.base}/admin/business`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual' });
  for (const body of ['name=Hacked', 'name=Hacked&_csrf=', 'name=Hacked&_csrf=wrong-token', 'name=Hacked&_csrf[]=x']) {
    const r = await send(body);
    assert.equal(r.status, 403, `${body} answered ${r.status}`);
  }
  // Another site's form posting a deal delete with the admin's cookie is refused too.
  const del = await fetch(`${shop.base}/admin/deals/${shop.deal.id}/delete`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example' }, body: 'confirm=yes', redirect: 'manual',
  });
  assert.equal(del.status, 403);
  assert.ok(shop.repo.dealById(shop.deal.id), 'the deal was not deleted');
  // With the real token from an admin page it works.
  const token = shop.csrfFrom(await (await fetch(`${shop.base}/admin`, { headers })).text());
  assert.ok(token);
  assert.equal((await send(`name=Real+Name&_csrf=${encodeURIComponent(token)}`)).status, 303);
});

test('security: wrong passwords lock the address out, and a faked X-Forwarded-For does not get around it', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  // trust proxy = 1: the hosting proxy appends the real address last; whatever the visitor put
  // before it is ignored. Each try below fakes a different first address.
  const attempt = (i, password = 'wrong') =>
    shop.raw('POST', '/admin/login', { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': `10.0.0.${i}, 203.0.113.7` }, `username=admin&password=${password}`);
  for (let i = 1; i <= 10; i++) assert.equal((await attempt(i)).status, 401);
  const locked = await attempt(11);
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers['retry-after']) > 0);
  // Even the right password waits until the lockout ends.
  assert.equal((await attempt(12, 'secret-pw')).status, 429);
  // Another real address is not affected.
  const other = await shop.raw('POST', '/admin/login', { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': '198.51.100.9' }, 'username=admin&password=secret-pw');
  assert.equal(other.status, 303);
  // The user name is checked as strictly as the password.
  const wrongUser = await shop.raw('POST', '/admin/login', { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': '198.51.100.10' }, 'username=Admin&password=secret-pw');
  assert.equal(wrongUser.status, 401);
});

test('security: after logging in, only pages inside the admin are followed (no open redirect)', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  for (const next of ['https://evil.example/', '//evil.example', '/\\evil.example', '/admin//evil.example', '/admin\\@evil.example', 'javascript:alert(1)', '/admin.evil.example']) {
    const r = await fetch(`${shop.base}/admin/login`, { method: 'POST', ...form({ username: 'admin', password: 'secret-pw', next }), redirect: 'manual' });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), '/admin', `next=${next} was followed`);
  }
  const page = await (await fetch(`${shop.base}/admin/login?next=${encodeURIComponent('//evil.example')}`)).text();
  assert.doesNotMatch(page, /evil\.example/);
});

test('security: the language links never point to another site', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  // "/.//evil.example" is the path "//evil.example" once "." is resolved: a link to it would be a
  // link to evil.example.
  for (const p of ['/.//evil.example', '/x/..//evil.example', '/%2e//evil.example/deals', '/deals/..//evil.example/x', '/.///evil.example']) {
    const r = await shop.raw('GET', p);
    const hrefs = [...r.text.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    for (const href of hrefs) {
      assert.ok(!/^\/\/|^\/\\|^[a-z]+:\/\/(?!shop\.test)/i.test(href) || /^https:\/\/(js\.stripe\.com|shop\.test)/.test(href), `${p}: link to another site: ${href}`);
    }
    assert.doesNotMatch(r.text, /href="https:\/\/shop\.test\/\//, `${p}: canonical link broken`);
  }
});

test('security: shop texts, search and form values are escaped (no XSS)', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const pages = [
    await (await fetch(`${shop.base}/?lang=en`)).text(),
    await (await fetch(`${shop.base}/deals/xss-lamp-1?lang=en`)).text(),
    await (await fetch(`${shop.base}/?q=${encodeURIComponent(XSS)}`)).text(),
    await (await fetch(`${shop.base}/?category=${encodeURIComponent(XSS)}`)).text(),
    await (await fetch(`${shop.base}/nope${encodeURIComponent(XSS)}`)).text(),
  ];
  // A join form sent back with errors shows the typed values again.
  const join = await fetch(`${shop.base}/deals/xss-lamp-1/join`, {
    method: 'POST', ...form({ name: XSS, email: 'bad', address_line1: XSS, city: XSS, postal_code: XSS, country: 'EE', lang: 'en' }),
  });
  assert.equal(join.status, 422);
  pages.push(await join.text());
  const headers = await adminLogin(shop.base);
  pages.push(await (await fetch(`${shop.base}/admin`, { headers })).text());
  pages.push(await (await fetch(`${shop.base}/admin/deals/${shop.deal.id}`, { headers })).text());
  for (const html of pages) {
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.doesNotMatch(html, /<img src=x onerror/);
  }
  // Legal pages (written in the admin): no markup and no script links get through.
  const legal = renderLegalText(`# T\n<script>alert(1)</script> [click](javascript:alert(1)) [x](//evil.example) [ok](https://example.com) **<b>bold</b>**`);
  assert.doesNotMatch(legal, /<script>|href="javascript:|href="\/\/evil|<b>/);
  assert.match(legal, /href="https:\/\/example\.com"/);
});

test('security: the price comes from the deal, not from the buyer\'s form', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const r = await fetch(`${shop.base}/deals/xss-lamp-1/join`, {
    method: 'POST', redirect: 'manual',
    ...form({ name: 'Anna', email: 'anna@example.com', address_line1: 'Narva mnt 5', postal_code: '10117', city: 'Tallinn', country: 'EE',
      accept_terms: 'yes', lang: 'en', price_cents: '1', amount_cents: '1', status: 'paid', deal_id: '999', token: 'mine' }),
  });
  assert.equal(r.status, 303);
  const [p] = shop.repo.participantsForDeal(shop.deal.id);
  assert.notEqual(p.status, 'paid');
  assert.notEqual(p.token, 'mine');
  assert.ok(p.token.length >= 32, 'buyer links are long random tokens');
  assert.equal(p.deal_id, shop.deal.id);
  assert.ok(!p.amount_cents || p.amount_cents >= 4900);
  // Guessing someone's payment link does not work.
  for (const guess of ['1', 'mine', 'a'.repeat(32), "' OR 1=1 --"]) {
    assert.equal((await fetch(`${shop.base}/join/${encodeURIComponent(guess)}`)).status, 404);
    assert.equal((await fetch(`${shop.base}/pay/${encodeURIComponent(guess)}`)).status, 404);
  }
});

test('security: Stripe webhooks need a valid signature from the right mode, and cron needs its secret', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const event = { id: 'evt_1', object: 'event', type: 'payment_intent.succeeded', livemode: false, data: { object: { id: 'pi_x', object: 'payment_intent', status: 'succeeded', metadata: {} } } };
  const payload = JSON.stringify(event);
  const post = (headers, body = payload) => fetch(`${shop.base}/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  assert.equal((await post({})).status, 400, 'no signature');
  assert.equal((await post({ 'Stripe-Signature': 't=1,v1=deadbeef' })).status, 400, 'made-up signature');
  const wrongSecret = shop.real.webhooks.generateTestHeaderString({ payload, secret: 'whsec_wrong' });
  assert.equal((await post({ 'Stripe-Signature': wrongSecret })).status, 400, 'signed with another secret');
  const signed = shop.real.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  assert.equal((await post({ 'Stripe-Signature': signed }, payload.replace('"succeeded"', '"canceled"'))).status, 400, 'changed after signing');
  const live = JSON.stringify({ ...event, id: 'evt_2', livemode: true });
  assert.equal((await post({ 'Stripe-Signature': shop.real.webhooks.generateTestHeaderString({ payload: live, secret: WEBHOOK_SECRET }) }, live)).status, 400, 'live event in test mode');

  for (const route of ['/api/cron/tick', '/api/cron/backup']) {
    assert.equal((await fetch(shop.base + route, { method: 'POST' })).status, 401);
    assert.equal((await fetch(shop.base + route, { method: 'POST', headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(shop.base + route, { method: 'POST', headers: { Authorization: `Bearer ${CRON_SECRET}x` } })).status, 401);
    assert.equal((await fetch(`${shop.base}${route}?secret=${CRON_SECRET}`, { method: 'POST' })).status, 401);
  }
  assert.equal((await fetch(`${shop.base}/api/cron/tick`, { method: 'POST', headers: { Authorization: `Bearer ${CRON_SECRET}` } })).status, 202);
});

test('security: requests for another domain go to the shop\'s own address (no Host header tricks)', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const r = await shop.raw('GET', '/admin/forgot', { Host: 'evil.example' });
  assert.equal(r.status, 301);
  assert.equal(r.headers.location, 'https://shop.test/admin/forgot');
  const post = await shop.raw('POST', '/admin/forgot', { Host: 'evil.example', 'Content-Type': 'application/x-www-form-urlencoded' }, '');
  assert.equal(post.status, 308);
  assert.match(post.headers.location, /^https:\/\/shop\.test\//);
});

test('security: protective headers are on every page, including errors', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  for (const p of ['/', '/deals/xss-lamp-1', '/does-not-exist', '/admin/login', '/admin/forgot', '/legal/privacy', '/robots.txt']) {
    const r = await shop.raw('GET', p);
    const h = r.headers;
    assert.match(h['content-security-policy'] || '', /default-src 'self'/, `${p}: CSP`);
    assert.match(h['content-security-policy'], /frame-ancestors 'none'/, `${p}: frame-ancestors`);
    assert.doesNotMatch(h['content-security-policy'], /script-src[^;]*'unsafe-(inline|eval)'/, `${p}: scripts may not be inline`);
    assert.equal(h['x-frame-options'], 'DENY', `${p}: X-Frame-Options`);
    assert.equal(h['x-content-type-options'], 'nosniff', `${p}: nosniff`);
    assert.match(h['strict-transport-security'] || '', /max-age=31536000/, `${p}: HSTS`);
    assert.ok(h['referrer-policy'], `${p}: Referrer-Policy`);
    assert.equal(h['x-powered-by'], undefined, `${p}: X-Powered-By`);
  }
  // Admin pages are never cached.
  assert.equal((await shop.raw('GET', '/admin/login')).headers['cache-control'], 'no-store');
});

test('security: oversized requests are refused', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const big = 'x'.repeat(200 * 1024);
  const r = await fetch(`${shop.base}/alerts`, { method: 'POST', ...form({ email: big }) });
  assert.equal(r.status, 413);
  const a = await fetch(`${shop.base}/api/assistant`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: big }] }) });
  assert.ok([413, 503].includes(a.status), `assistant answered ${a.status}`);
});

test('security: uploads must really be photos, and are saved under random names', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const headers = await adminLogin(shop.base);
  const token = shop.csrfFrom(await (await fetch(`${shop.base}/admin`, { headers })).text());
  const upload = async (name, bytes, type) => {
    const body = new FormData();
    body.append('_csrf', token);
    body.append('photos', new Blob([bytes], { type }), name);
    return fetch(`${shop.base}/admin/deals/${shop.deal.id}/photos`, { method: 'POST', headers, body, redirect: 'manual' });
  };
  // An HTML page and an SVG with a script, dressed up as photos, are refused.
  await upload('evil.jpg', Buffer.from('<html><script>alert(1)</script></html>'.padEnd(64)), 'image/jpeg');
  await upload('evil.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'.padEnd(64)), 'image/svg+xml');
  await upload('../../../evil.png', Buffer.from('not a png'.padEnd(64)), 'image/png');
  assert.equal(shop.repo.photosForDeal(shop.deal.id).length, 0, 'no fake photo was saved');
  // A real (tiny) PNG is accepted and gets a random file name, whatever it was called.
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  await upload('../../../../tmp/owned.png', png, 'image/png');
  const [photo] = shop.repo.photosForDeal(shop.deal.id);
  assert.ok(photo, 'the real photo was saved');
  assert.match(photo.filename, /^[a-f0-9]{24}\.(png|webp|jpg)$/);
  assert.ok(!fs.existsSync('/tmp/owned.png'));
});

test('security: the example secrets from .env.example (public on GitHub) stop real orders', async (t) => {
  const shop = await startShop();
  t.after(shop.close);
  const secrets = () => goLiveChecks(shop.ctx).find((c) => c.label === 'Secrets');
  assert.equal(secrets().ok, true);
  Object.assign(shop.ctx.config, { appSecret: 'change-me-to-a-long-random-string', cronSecret: 'change-me-too' });
  assert.equal(secrets().ok, false);
  assert.match(secrets().detail, /APP_SECRET, CRON_SECRET/);
  shop.ctx.config.paymentsMode = 'live';
  assert.ok(liveProblems(shop.ctx).some((p) => p.label === 'Secrets'), 'live mode pauses orders');
});

test('security: copying product photos never reaches this server or private networks (SSRF)', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  assert.equal(isPrivateAddress('93.184.216.34'), false);
  for (const url of [
    'http://127.0.0.1/x.jpg', 'http://localhost/x.jpg', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/x.jpg',
    'http://2130706433/x.jpg', 'http://0x7f.1/x.jpg', 'http://017700000001/x.jpg', 'http://[::ffff:127.0.0.1]/x.jpg',
    'file:///etc/passwd', 'ftp://example.com/x.jpg', 'http://user:pass@example.com/x.jpg', 'http://example.com:22/x.jpg',
  ]) {
    await assert.rejects(downloadImage(url), ImageFetchError, url);
  }
});
