import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDb, createRepo } from '../src/db.js';
import { hmac } from '../src/util.js';
import { publicRoutes } from '../src/routes/public.js';
import { legalRoutes } from '../src/routes/legal.js';
import { adminRoutes } from '../src/routes/admin.js';
import { seoRoutes } from '../src/routes/seo.js';
import { createPhotoStore } from '../src/photos.js';
import { cleanTag, createAnalytics, deviceType, isBot, shopDay, visitSource } from '../src/analytics.js';
import { buildReport, validateAdSpend } from '../src/performance.js';
import { adminLogin } from './support/admin.js';

const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// What the join form would save as the buyer's source, for the visitor making the request.
const testRoutes = (app, ctx) => app.get('/test/source', (req, res) => res.json(ctx.analytics.sourceOf(req)));

async function startApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-perf-'));
  let now = new Date('2026-11-20T10:00:00Z');
  const clock = { now: () => new Date(now) };
  const config = {
    baseUrl: 'https://shop.test', adminUser: 'admin', adminPassword: 'secret-pw', appSecret: 'test-secret-0123456789abcdef',
    defaultTaxCode: 'txcd_99999999', uploadDir: path.join(dir, 'uploads'), trustProxy: false,
    business: { name: 'SEK Digital OÜ', address: 'Tallinn', email: 'hello@shop.test', vatId: 'EE1', registration: 'r', supervisoryAuthority: 'AKI', phone: '+372 5555 5555' },
  };
  const repo = createRepo(openDb(path.join(dir, 'db.sqlite')));
  const ctx = { config, repo, clock, photos: createPhotoStore(config.uploadDir), assistant: null, routes: [seoRoutes, legalRoutes, publicRoutes, adminRoutes, testRoutes] };
  const server = createApp(ctx).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = await adminLogin(base);
  const csrf = hmac(config.appSecret, 'admin-csrf');
  const visit = (p, headers = {}) => fetch(base + p, { headers: { 'User-Agent': DESKTOP, ...headers } }).then((r) => r.text());
  const post = (p, fields) =>
    fetch(base + p, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, ...fields }), redirect: 'manual',
    });
  const deal = repo.insertDeal({
    slug: 'garlic-press', product_name: 'Steel garlic press', description: 'Crushes garlic in one squeeze.\n\nDishwasher safe.', image_url: '',
    category: 'home', headline: 'Never peel again', social_post: '', price_cents: 1999, tax_code: 'txcd_99999999', min_buyers: 5,
    deadline: '2026-11-30T20:00:00.000Z', created_at: '2026-11-18T09:00:00.000Z',
  });
  repo.addPhoto(deal.id, 'abc123.jpg', '2026-11-18T09:00:00.000Z');
  return {
    base, auth, csrf, repo, ctx, deal, visit, post,
    get: (p, headers = {}) => fetch(base + p, { headers: { 'User-Agent': DESKTOP, ...headers } }).then((r) => r.text()),
    setNow: (iso) => { now = new Date(iso); },
    close: () => server.close(),
  };
}

const participant = (repo, deal, over) =>
  repo.db
    .prepare(
      `INSERT INTO participants (deal_id, token, email, name, address_line1, postal_code, city, country, terms_accepted_at,
         status, amount_cents, tax_cents, payment_method_id, source, medium, campaign, lang, created_at, updated_at, paid_at)
       VALUES (:deal_id, :token, :email, 'A', 'Street 1', '1000', 'City', :country, :t, :status, :amount_cents, :tax_cents,
         :payment_method_id, :source, :medium, :campaign, :lang, :t, :t, :paid_at)`
    )
    .run({
      deal_id: deal.id, token: Math.random().toString(36).slice(2), email: `${Math.random()}@x.test`, country: 'DE', t: '2026-11-20T09:00:00.000Z',
      status: 'saved', amount_cents: 1999, tax_cents: 319, payment_method_id: 'pm_1', source: '', medium: '', campaign: '', lang: 'de', paid_at: null, ...over,
    });

test('where a visit came from: ad tags, click ids, referring sites, clicks inside the shop', () => {
  const own = ['shop.test'];
  assert.deepEqual(visitSource({ query: { utm_source: 'FB', utm_medium: 'Paid', utm_campaign: 'Black Friday 2026' }, ownHosts: own }), {
    entry: true, source: 'facebook', medium: 'paid', campaign: 'black-friday-2026', referrer: '',
  });
  assert.equal(visitSource({ query: { gclid: 'x' }, referer: 'https://www.google.com/', ownHosts: own }).medium, 'cpc');
  assert.equal(visitSource({ query: { fbclid: 'x' }, referer: 'https://l.facebook.com/', ownHosts: own }).source, 'facebook');
  assert.deepEqual(visitSource({ referer: 'https://www.google.de/', ownHosts: own }), { entry: true, source: 'google', medium: 'organic', campaign: '', referrer: 'google.de' });
  assert.equal(visitSource({ referer: 'https://mail.google.com/mail/u/0/', ownHosts: own }).source, 'email');
  assert.equal(visitSource({ referer: 'https://lm.facebook.com/', ownHosts: own }).source, 'facebook');
  assert.equal(visitSource({ referer: 'https://t.co/abc', ownHosts: own }).source, 'x');
  assert.equal(visitSource({ referer: 'android-app://com.google.android.gm/', ownHosts: own }).source, 'email');
  assert.deepEqual(visitSource({ referer: 'https://www.some-blog.eu/post', ownHosts: own }), { entry: true, source: 'some-blog.eu', medium: 'referral', campaign: '', referrer: 'some-blog.eu' });
  assert.equal(visitSource({ referer: '', ownHosts: own }).source, 'direct');
  assert.equal(visitSource({ referer: 'https://shop.test/deals/x', ownHosts: own }).entry, false, 'a click inside the shop is not a new visit');
  assert.equal(cleanTag(' Été <script> Sale! '), 'ete-script-sale');
});

test('robots and link previews are not visitors; phones are told apart', () => {
  assert.equal(isBot(PHONE), false);
  assert.equal(isBot(DESKTOP), false);
  for (const ua of [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'WhatsApp/2.23.20.0 A',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Mozilla/5.0 (compatible; bingbot/2.0)',
    'curl/8.4.0', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36',
    'TelegramBot (like TwitterBot)', 'Slackbot-LinkExpanding 1.0', '',
  ]) assert.equal(isBot(ua), true, ua);
  assert.equal(deviceType(PHONE), 'phone');
  assert.equal(deviceType(DESKTOP), 'computer');
  assert.equal(deviceType('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'), 'tablet');
});

test('page views are recorded without cookies; the dashboard shows sources, campaigns, the funnel and ad spend', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const { repo, deal } = app;

  // A phone arrives from a Facebook ad, then opens the deal from the home page.
  const res = await fetch(`${app.base}/?utm_source=fb&utm_medium=paid&utm_campaign=Black%20Friday`, { headers: { 'User-Agent': PHONE } });
  assert.equal(res.headers.get('set-cookie'), null, 'no cookie is set for the statistics');
  await res.text();
  await app.visit('/deals/garlic-press', { 'User-Agent': PHONE, Referer: 'https://shop.test/' });
  // Someone else from Google search, one typing the address, and a link preview robot.
  await app.visit('/deals/garlic-press?lang=de', { Referer: 'https://www.google.de/' });
  await app.visit('/terms');
  await app.visit('/deals/garlic-press', { 'User-Agent': 'facebookexternalhit/1.1' });
  // Not counted: admin, a missing page, a buyer's private page.
  await app.get('/admin', app.auth);
  await app.visit('/deals/nope');
  await app.visit('/join/secret-token');
  await new Promise((r) => setTimeout(r, 20)); // views are written once the response has finished

  const rows = repo.db.prepare('SELECT * FROM page_views ORDER BY id').all();
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => [r.path, r.entry, r.source, r.device]), [
    ['/', 1, 'facebook', 'phone'], ['/deals/garlic-press', 0, '', 'phone'], ['/deals/garlic-press', 1, 'google', 'computer'], ['/terms', 1, 'direct', 'computer'],
  ]);
  assert.equal(rows[0].campaign, 'black-friday');
  assert.equal(rows[1].deal_id, deal.id);
  assert.equal(rows[2].lang, 'de');
  assert.equal(rows[0].visitor, rows[1].visitor, 'the same visitor on the same day');
  assert.notEqual(rows[0].visitor, rows[2].visitor);
  for (const r of rows) assert.doesNotMatch(JSON.stringify(r), /127\.0\.0\.1|::1/, 'no IP address is stored');

  // The phone visitor joins: their visit's source goes with the order.
  const src = JSON.parse(await app.visit('/test/source', { 'User-Agent': PHONE }));
  assert.deepEqual(src, { source: 'facebook', medium: 'paid', campaign: 'black-friday' });
  assert.equal(JSON.parse(await app.visit('/test/source')).source, 'google', 'the last source other than direct wins');

  participant(repo, deal, { ...src, status: 'paid', paid_at: '2026-11-20T09:30:00.000Z' });
  participant(repo, deal, { source: 'google', medium: 'organic', country: 'AT' });
  participant(repo, deal, { source: 'facebook', medium: 'paid', campaign: 'black-friday', status: 'pending_setup', payment_method_id: null });

  // Ad spend: a bad amount is refused, a good one is saved.
  assert.equal((await app.post('/admin/performance/spend?days=30', { day: '2026-11-19', source: 'facebook', campaign: 'Black Friday', amount: 'ten' })).status, 422);
  const saved = await app.post('/admin/performance/spend?days=30', { day: '2026-11-19', source: 'facebook', campaign: 'Black Friday', amount: '12,50', note: 'Meta ads' });
  assert.equal(saved.status, 303);
  assert.equal(repo.adSpendBetween('2026-11-01', '2026-11-30')[0].amount_cents, 1250);

  const report = buildReport(repo, { days: 30, now: app.ctx.clock.now() });
  assert.equal(report.totals.visitors, 2, "the Google and the typed-in visits were the same computer");
  assert.equal(report.totals.visits, 3);
  assert.equal(report.totals.started, 3);
  assert.equal(report.totals.joined, 2);
  assert.equal(report.totals.paid, 1);
  assert.equal(report.totals.revenueCents, 1999);
  assert.equal(report.totals.spendCents, 1250);
  const fb = report.sources.find((s) => s.source === 'facebook');
  assert.equal(fb.joined, 1);
  assert.equal(fb.costPerBuyerCents, 1250);
  assert.equal(fb.roas.toFixed(2), '1.60');
  assert.equal(report.campaigns.find((c) => c.campaign === 'black-friday').spendCents, 1250);
  const d = report.deals.find((x) => x.deal.id === deal.id);
  assert.deepEqual([d.visitors, d.started, d.joined, d.paid], [2, 3, 2, 1]);
  assert.deepEqual(report.countries.map((c) => c.code).sort(), ['AT', 'DE']);
  assert.equal(report.series.length, 30);
  assert.equal(report.series.at(-1).visitors, 2);

  const page = await app.get('/admin/performance', app.auth);
  assert.match(page, /📊 Performance/);
  assert.match(page, /Facebook/);
  assert.match(page, /<code>black-friday<\/code>/);
  assert.match(page, /€12\.50|12\.50/);
  assert.match(page, /Steel garlic press/);
  assert.match(page, /data-link-maker/);
  assert.match(await app.get('/admin/performance?days=365', app.auth), /Visitors per week/);

  // Removing the ad spend
  const id = repo.adSpendBetween('2026-11-01', '2026-11-30')[0].id;
  assert.equal((await app.post(`/admin/performance/spend/${id}/delete?days=30`, {})).status, 303);
  assert.equal(repo.adSpendBetween('2026-11-01', '2026-11-30').length, 0);

  // Without the admin password, no dashboard: the login page instead.
  const loggedOut = await fetch(`${app.base}/admin/performance`, { redirect: 'manual' });
  assert.equal(loggedOut.status, 303);
  assert.match(loggedOut.headers.get('location'), /^\/admin\/login\?next=/);
});

test('the daily key changes, so visitors cannot be followed across days; old visits are deleted', () => {
  const repo = createRepo(openDb(':memory:'));
  let now = new Date('2026-11-20T10:00:00Z');
  const analytics = createAnalytics({ repo, clock: { now: () => now }, config: { baseUrl: 'https://shop.test' } });
  const req = { ip: '1.2.3.4', query: {}, hostname: 'shop.test', get: (h) => ({ 'user-agent': DESKTOP })[h.toLowerCase()] };
  repo.insertVisit({ day: '2025-01-01', created_at: '2025-01-01T00:00:00Z', path: '/', deal_id: null, visitor: 'old', entry: 1, source: 'direct', medium: '', campaign: '', referrer: '', lang: 'en', device: 'computer' });
  analytics.recordView(req, { path: '/' });
  now = new Date('2026-11-21T10:00:00Z');
  analytics.recordView(req, { path: '/' });
  const rows = repo.db.prepare('SELECT * FROM page_views ORDER BY id').all();
  assert.deepEqual(rows.map((r) => r.day), ['2026-11-20', '2026-11-21'], 'visits older than 13 months are gone');
  assert.notEqual(rows[0].visitor, rows[1].visitor);
  assert.equal(JSON.parse(repo.getAdminSetting('analytics-salt').value).day, '2026-11-21', "only today's key is kept");
  assert.equal(shopDay('2026-11-20T23:30:00Z'), '2026-11-21', 'days follow the shop time zone (Brussels)');
});

test('ad spend form checks', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  assert.deepEqual(Object.keys(validateAdSpend({ day: '2026-11-19', source: 'tiktok', amount: '9.99' }, now).errors), []);
  assert.equal(validateAdSpend({ day: '2026-11-19', source: 'tiktok', amount: '9.99' }, now).values.amount_cents, 999);
  assert.deepEqual(Object.keys(validateAdSpend({ day: '2026-02-30', source: '', amount: '-5' }, now).errors).sort(), ['amount', 'day', 'source']);
  assert.ok(validateAdSpend({ day: '2027-01-01', source: 'x', amount: '5' }, now).errors.day, 'not in the future');
  assert.equal(validateAdSpend({ day: '2026-11-19', source: 'other', other_source: 'My Blog', amount: '5' }, now).values.source, 'my-blog');
});

test('link previews, product data, sitemap and robots.txt', async (t) => {
  const app = await startApp();
  t.after(app.close);

  const page = await app.get('/deals/garlic-press?lang=de&utm_source=fb&fbclid=abc');
  assert.match(page, /<meta property="og:type" content="product">/);
  assert.match(page, /<meta property="og:image" content="https:\/\/shop\.test\/uploads\/abc123\.jpg">/);
  assert.match(page, /<meta property="og:title" content="Steel garlic press – 19,99\s€">/);
  assert.match(page, /<meta property="product:price:amount" content="19\.99">/);
  assert.match(page, /<meta property="og:locale" content="de_DE">/);
  assert.match(page, /<link rel="canonical" href="https:\/\/shop\.test\/deals\/garlic-press\?lang=de">/, 'ad tags are not part of the page address');
  assert.doesNotMatch(page, /hreflang="fr" href="[^"]*utm_source/);
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld['@type'], 'Product');
  assert.equal(ld.offers.price, '19.99');
  assert.equal(ld.offers.priceCurrency, 'EUR');
  assert.equal(ld.offers.availability, 'https://schema.org/InStock');
  assert.equal(ld.offers.seller.name, 'SEK Digital OÜ');
  // Share buttons say where the deal was shared.
  assert.match(page, /utm_source%3Dwhatsapp%26utm_medium%3Dshare/);

  const home = await app.get('/');
  assert.match(home, /<meta property="og:title" content="Buy together\. Pay less\.">/);
  assert.match(home, /<meta name="description" content="Team up with other shoppers/);
  assert.match(home, /og:image" content="https:\/\/shop\.test\/uploads\/abc123\.jpg"/);

  const privatePage = await app.get('/join/some-secret-token');
  assert.match(privatePage, /<meta name="robots" content="noindex, nofollow">/);
  assert.doesNotMatch(privatePage, /og:url|rel="canonical"|rel="alternate"/, 'a buyer’s private link is never repeated in the page');

  const robots = await app.get('/robots.txt');
  assert.match(robots, /Disallow: \/admin/);
  assert.match(robots, /Disallow: \/join\//);
  assert.match(robots, /Sitemap: https:\/\/shop\.test\/sitemap\.xml/);

  const sitemap = await app.get('/sitemap.xml');
  assert.match(sitemap, /<loc>https:\/\/shop\.test\/deals\/garlic-press\?lang=ru<\/loc>/);
  assert.match(sitemap, /hreflang="x-default" href="https:\/\/shop\.test\/\?lang=en"/);
  assert.equal(sitemap.match(/<url>/g).length, 5 * 25, 'home, 1 deal and 3 legal pages in 25 languages');
});
