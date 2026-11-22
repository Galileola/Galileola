import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDb, createRepo } from '../src/db.js';
import { systemClock, hmac } from '../src/util.js';
import { publicRoutes } from '../src/routes/public.js';
import { legalRoutes } from '../src/routes/legal.js';
import { adminRoutes } from '../src/routes/admin.js';
import { createPhotoStore } from '../src/photos.js';
import { createTranslator } from '../src/translate.js';
import { renderLegalText, htmlToLegalText } from '../src/legalText.js';
import { adminLogin } from './support/admin.js';

test('legal text formatting: headings, lists, notes, tables, links, and nothing unsafe', () => {
  const html = renderLegalText(`# Terms
## 6. Withdrawal {#withdrawal}
A line
and the next line.

- **One** item
- Two: [terms](/terms#withdrawal) and [Stripe](https://stripe.com)
> Check this
| A | B |
|---|---|
| \`x\` | y |
[cookie-settings: Change settings]
<script>alert(1)</script> [bad](javascript:alert(1)) [also bad](//evil.example)`);
  assert.match(html, /<h1>Terms<\/h1>/);
  assert.match(html, /<h2 id="withdrawal">6\. Withdrawal<\/h2>/);
  assert.match(html, /<p>A line<br>and the next line\.<\/p>/);
  assert.match(html, /<ul><li><strong>One<\/strong> item<\/li><li>Two: <a href="\/terms#withdrawal">terms<\/a> and <a href="https:\/\/stripe\.com" rel="noopener">Stripe<\/a><\/li><\/ul>/);
  assert.match(html, /<div class="notice warn small">Check this<\/div>/);
  assert.match(html, /<table><thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead><tbody><tr><td><code>x<\/code><\/td><td>y<\/td><\/tr><\/tbody><\/table>/);
  assert.match(html, /<button type="button" class="secondary" data-cookie-settings>Change settings<\/button>/);
  assert.doesNotMatch(html, /<script>|href="javascript|href="\/\/evil/);
  assert.match(html, /&lt;script&gt;/);
});

async function startApp(assistant = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-legal-'));
  const config = {
    baseUrl: 'https://shop.test', adminUser: 'admin', adminPassword: 'secret-pw', appSecret: 'test-secret-0123456789abcdef',
    defaultTaxCode: 'txcd_99999999', uploadDir: path.join(dir, 'uploads'), trustProxy: false,
    business: { name: 'Test Shop', address: 'Street 1', email: 'shop@example.com', vatId: 'EE1', registration: 'R1', supervisoryAuthority: 'DPA' },
  };
  const repo = createRepo(openDb(path.join(dir, 'db.sqlite')));
  const translator = createTranslator({ assistant, repo, clock: systemClock });
  const ctx = { config, repo, clock: systemClock, photos: createPhotoStore(config.uploadDir), assistant, translator, routes: [legalRoutes, publicRoutes, adminRoutes] };
  const server = createApp(ctx).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = await adminLogin(base);
  const csrf = hmac(config.appSecret, 'admin-csrf');
  const get = async (p, headers = {}) => {
    const r = await fetch(base + p, { headers });
    return { status: r.status, html: await r.text() };
  };
  const save = (page, lang, fields) =>
    fetch(`${base}/admin/legal/${page}/${lang}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, ...fields }),
      redirect: 'manual',
    });
  return { base, auth, csrf, repo, translator, get, save, close: () => server.close() };
}

test('the owner writes a text per language; other languages show English with a note', async (t) => {
  const app = await startApp();
  t.after(app.close);

  const overview = await app.get('/admin/legal', app.auth);
  assert.equal(overview.status, 200);
  assert.equal((overview.html.match(/href="\/admin\/legal\/terms\/[a-z]{2}"/g) ?? []).length, 25);

  const editor = await app.get('/admin/legal/terms/de', app.auth);
  assert.equal(editor.status, 200);
  assert.match(editor.html, /<textarea id="legal-body"[^>]*><\/textarea>/, 'no German text yet: the box starts empty');
  assert.match(editor.html, /## 6\. Right of withdrawal \{#withdrawal\}/, 'the English text is there to start from');
  assert.match(editor.html, /AI translation needs ANTHROPIC_API_KEY/);

  const before = await app.get('/terms?lang=de');
  assert.match(before.html, /Diese Seite gibt es vorerst nur auf Englisch\./);
  assert.match(before.html, /<article class="legal" lang="en">/);

  const r = await app.save('terms', 'de', { action: 'save', body: '# AGB\n\n## Widerrufsrecht {#withdrawal}\nSie haben 14 Tage Zeit.' });
  assert.equal(r.status, 303);
  const german = await app.get('/terms?lang=de');
  assert.match(german.html, /<article class="legal" lang="de">/);
  assert.match(german.html, /<h1>AGB<\/h1>/);
  assert.match(german.html, /<h2 id="withdrawal">Widerrufsrecht<\/h2>/);
  assert.doesNotMatch(german.html, /automatisch aus dem Englischen übersetzt|nur auf Englisch/);

  const french = await app.get('/terms?lang=fr');
  assert.match(french.html, /<h1>Terms and conditions<\/h1>/);
  assert.match(french.html, /disponible qu&#39;en anglais/);

  await app.save('terms', 'en', { action: 'save', body: '# Our terms\n\nShort and simple.' });
  assert.match((await app.get('/terms?lang=fr')).html, /<h1>Our terms<\/h1>/, 'the owner\'s English text replaces the built-in one');
  assert.match((await app.get('/terms?lang=de&original=1')).html, /<h1>Our terms<\/h1>/);
  assert.match((await app.get('/admin/legal', app.auth)).html, /Own text/);

  await app.save('terms', 'de', { action: 'delete' });
  assert.match((await app.get('/terms?lang=de')).html, /<h1>Our terms<\/h1>/);
  await app.save('terms', 'en', { action: 'delete' });
  assert.match((await app.get('/terms')).html, /<h1>Terms and conditions<\/h1>/);
});

test('long texts in any script can be saved, empty ones and forged forms cannot', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const long = '# Условия\n\n' + 'Покупатель может отказаться от покупки в течение 14 дней. '.repeat(500);
  const r = await app.save('privacy', 'ru', { action: 'save', body: long });
  assert.equal(r.status, 303, 'a text of ~30,000 Cyrillic characters is accepted');
  assert.equal(app.repo.legalText('privacy', 'ru').body.trim(), long.trim());

  const empty = await app.save('privacy', 'ru', { action: 'save', body: '   ' });
  assert.equal(empty.status, 422);

  const forged = await fetch(`${app.base}/admin/legal/privacy/ru`, {
    method: 'POST',
    headers: { ...app.auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: 'wrong', action: 'delete' }),
    redirect: 'manual',
  });
  assert.equal(forged.status, 403);
  assert.ok(app.repo.legalText('privacy', 'ru'));
  assert.equal((await app.get('/admin/legal/privacy/xx', app.auth)).status, 404);
});

test('"Translate with AI" drafts a language from the English text without saving it', async (t) => {
  const calls = [];
  const assistant = {
    model: 'fake',
    async reply({ system, messages }) {
      calls.push({ system, input: messages[0].content });
      return { text: '```\n# Conditions générales\n\n## Droit de rétractation {#withdrawal}\n```' };
    },
  };
  const app = await startApp(assistant);
  t.after(app.close);
  const r = await fetch(`${app.base}/admin/legal/cookies/fr/draft`, {
    method: 'POST',
    headers: { ...app.auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ _csrf: app.csrf }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).text, '# Conditions générales\n\n## Droit de rétractation {#withdrawal}\n');
  assert.match(calls[0].system, /into French/);
  assert.match(calls[0].input, /^# Cookies/);
  assert.equal(app.repo.legalText('cookies', 'fr'), undefined, 'a draft is not saved');
});

test('the built-in English pages convert to editable text and back without losing sections', () => {
  const views = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'views', 'legal');
  for (const page of ['terms', 'privacy', 'cookies']) {
    const ejsSource = fs.readFileSync(path.join(views, `${page}-body.ejs`), 'utf8');
    // A rough render: drop the comment and the assistant-only blocks, fill in the business details.
    const html = ejsSource
      .replace(/<%#[\s\S]*?%>/g, '')
      .replace(/<% if \(assistantEnabled\) \{ %>[\s\S]*?<% \} %>/g, '')
      .replace(/<%= business\.(\w+) %>/g, (m, k) => `[${k}]`);
    const round = renderLegalText(htmlToLegalText(html));
    const count = (s, re) => (s.match(re) ?? []).length;
    for (const tag of [/<h[1-3][ >]/g, /<li>/g, /<a /g, /<tr>/g, /<code>/g, /<strong>/g, /data-cookie-settings/g]) {
      assert.equal(count(round, tag), count(html, tag), `${page}: ${tag} count changed`);
    }
    for (const id of html.match(/id="[^"]+"/g) ?? []) assert.ok(round.includes(id), `${page}: lost ${id}`);
  }
});
