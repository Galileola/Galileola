import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDb, createRepo } from '../src/db.js';
import { systemClock, hmac } from '../src/util.js';
import { publicRoutes } from '../src/routes/public.js';
import { adminRoutes } from '../src/routes/admin.js';
import { createPhotoStore } from '../src/photos.js';
import {
  ImportError,
  decodeCsv,
  extractImageUrls,
  guessCategory,
  htmlToText,
  parseCsv,
  parseSourcePrice,
  readProductFile,
  templateCsv,
} from '../src/productImport.js';
import { ImageFetchError, createImageImporter, downloadImage, isPrivateAddress } from '../src/imageImport.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(24)]);

// ---------------------------------------------------------------------------------------------
// Reading files

test('CSV: quotes, line breaks in quotes, semicolons, BOM, Windows-1252 and blank rows', () => {
  assert.deepEqual(parseCsv('a,b,c\r\n1,"two, ""2""","x\ny"\r\n\r\n,,\n4,5,6'), [
    ['a', 'b', 'c'],
    ['1', 'two, "2"', 'x\ny'],
    ['4', '5', '6'],
  ]);
  assert.deepEqual(parseCsv('name;price\nLamp;"49,90"\n'), [['name', 'price'], ['Lamp', '49,90']]);
  assert.deepEqual(parseCsv('name\tprice\nLamp\t9'), [['name', 'price'], ['Lamp', '9']]);
  assert.equal(decodeCsv(Buffer.from('﻿name\nCafé', 'utf8')), 'name\nCafé');
  // "Café" saved by an old Excel (é = 0xE9 in Windows-1252) is not valid UTF-8.
  assert.equal(decodeCsv(Buffer.from([0x6e, 0x0a, 0x43, 0x61, 0x66, 0xe9])), 'n\nCafé');
});

test('HTML descriptions become plain paragraphs', () => {
  assert.equal(
    htmlToText('<h2>Great&nbsp;lamp</h2><p>Warm light &amp; <strong>dimmable</strong>.<br>USB-C.</p><ul><li>Oak</li><li>Brass</li></ul><script>alert(1)</script>'),
    'Great lamp\n\nWarm light & dimmable.\nUSB-C.\n\n- Oak\n- Brass'
  );
  assert.equal(htmlToText('Plain text\r\n\r\n\r\nSecond'), 'Plain text\n\nSecond');
  assert.equal(htmlToText('5 &lt; 6 &#8364; &#x1F600;'), '5 < 6 € 😀');
});

test('prices, image addresses and categories from other shops', () => {
  assert.equal(parseSourcePrice('49.00'), 4900);
  assert.equal(parseSourcePrice('49,90'), 4990);
  assert.equal(parseSourcePrice('1.299,00 €'), 129900);
  assert.equal(parseSourcePrice('EUR 1,299.50'), 129950);
  assert.equal(parseSourcePrice('19.995'), 2000);
  assert.ok(Number.isNaN(parseSourcePrice('$20')));
  assert.ok(Number.isNaN(parseSourcePrice('')));

  assert.deepEqual(extractImageUrls('https://a.test/1.jpg, https://a.test/2.jpg|http://b.test/3.png; https://a.test/1.jpg'), [
    'https://a.test/1.jpg', 'https://a.test/2.jpg', 'http://b.test/3.png',
  ]);
  assert.deepEqual(extractImageUrls('no images here'), []);

  assert.equal(guessCategory('Clothing > Hoodies, Shoes'), 'fashion');
  assert.equal(guessCategory('Headphones and audio'), 'electronics');
  assert.equal(guessCategory('Dog toys and pet beds'), 'pets');
  assert.equal(guessCategory('Garden tools'), 'garden');
  assert.equal(guessCategory('Coffee & tea'), 'food');
  assert.equal(guessCategory('Misc'), '');
});

test('Shopify export: rows grouped by Handle, images in order, variants and drafts noted', () => {
  const csv = [
    'Handle,Title,Body (HTML),Vendor,Product Category,Type,Tags,Published,Option1 Name,Option1 Value,Variant SKU,Variant Price,Variant Compare At Price,Image Src,Image Position,Image Alt Text,Variant Tax Code,Status',
    'oak-lamp,Oak desk lamp,"<p>Warm light.</p><p>Dimmable.</p>",Acme,Home & Garden > Lighting,Lamps,"home, light",TRUE,Colour,Oak,L-1,49.00,59.00,https://cdn.shop.test/lamp-2.jpg,2,,,active',
    'oak-lamp,,,,,,,,,Walnut,L-2,54.00,,https://cdn.shop.test/lamp-1.jpg,1,,,',
    'hoodie,Organic hoodie,Soft cotton,Acme,Apparel & Accessories > Clothing,Hoodies,,FALSE,Size,M,H-1,39.90,,https://cdn.shop.test/hoodie.jpg,1,,txcd_30011000,draft',
    'orphan,,,,,,,,,,,10.00,,,,,,',
  ].join('\n');
  const { format, products, skipped } = readProductFile(csv);
  assert.equal(format, 'shopify');
  assert.equal(products.length, 2);
  const [lamp, hoodie] = products;
  assert.equal(lamp.name, 'Oak desk lamp');
  assert.equal(lamp.description, 'Warm light.\n\nDimmable.');
  assert.equal(lamp.priceCents, 4900, "the first variant's price");
  assert.deepEqual(lamp.images, ['https://cdn.shop.test/lamp-1.jpg', 'https://cdn.shop.test/lamp-2.jpg']);
  assert.equal(lamp.category, 'home');
  assert.equal(lamp.hidden, false);
  assert.match(lamp.notes.join(' '), /2 variants/);
  assert.equal(hoodie.category, 'fashion');
  assert.equal(hoodie.hidden, true);
  assert.equal(hoodie.taxCode, 'txcd_30011000');
  assert.match(hoodie.notes.join(' '), /Not published/);
  assert.deepEqual(skipped.map((s) => s.line), [5]);
});

test('WooCommerce export: variations folded into their parent with the lowest price', () => {
  const csv = [
    'ID,Type,SKU,Name,Published,Short description,Description,Sale price,Regular price,Categories,Tags,Images,Parent',
    '10,simple,MUG-1,Ceramic mug,1,Holds 350 ml,"<p>Dishwasher safe.</p>",,"12,50",Home > Kitchen,,"https://wp.test/mug.jpg, https://wp.test/mug-2.jpg",',
    '11,variable,TEE,Cotton T-shirt,1,,Soft tee,,,Clothing,,https://wp.test/tee.jpg,',
    '12,variation,TEE-S,Cotton T-shirt - S,1,,,,19.00,,,https://wp.test/tee-s.jpg,id:11',
    '13,variation,TEE-M,Cotton T-shirt - M,1,,,15.00,19.00,,,,TEE',
    '14,grouped,SET,Gift set,1,,,,,,,,',
    '15,simple,OLD,Old product,-1,,,,5.00,,,,',
    '16,variation,X,Lost variation,1,,,,5.00,,,,id:999',
  ].join('\n');
  const { format, products, skipped } = readProductFile(csv);
  assert.equal(format, 'woocommerce');
  assert.deepEqual(products.map((p) => p.name), ['Ceramic mug', 'Cotton T-shirt', 'Old product']);
  const [mug, tee, old] = products;
  assert.equal(mug.priceCents, 1250);
  assert.equal(mug.headline, 'Holds 350 ml');
  assert.equal(mug.description, 'Dishwasher safe.');
  assert.deepEqual(mug.images, ['https://wp.test/mug.jpg', 'https://wp.test/mug-2.jpg']);
  assert.equal(mug.category, 'home');
  assert.equal(tee.priceCents, 1500, 'the lowest variation price, sale price first');
  assert.deepEqual(tee.images, ['https://wp.test/tee.jpg', 'https://wp.test/tee-s.jpg']);
  assert.match(tee.notes.join(' '), /2 variations/);
  assert.equal(old.hidden, true);
  assert.equal(skipped.length, 2);
  assert.match(skipped.map((s) => s.reason).join(' '), /grouped/);
});

test('simple spreadsheets: any column order, EU separators, the template, and helpful errors', () => {
  // Headers it doesn't know: the error names the columns it found.
  assert.throws(() => readProductFile('Titel;Preis\nLampe;9'), (err) => err instanceof ImportError && /no product name column/.test(err.message));

  const { format, products } = readProductFile(
    'Title;Price;Image 1;Image 2;Category;Minimum buyers;Days\nDesk lamp;"29,90";https://x.test/a.jpg;https://x.test/b.jpg;home;5;10\n;9;;;;;\n'
  );
  assert.equal(format, 'spreadsheet');
  assert.equal(products.length, 1);
  assert.deepEqual(
    { name: products[0].name, price: products[0].priceCents, images: products[0].images, category: products[0].category, min: products[0].minBuyers, days: products[0].days },
    { name: 'Desk lamp', price: 2990, images: ['https://x.test/a.jpg', 'https://x.test/b.jpg'], category: 'home', min: 5, days: 10 }
  );

  const template = readProductFile(decodeCsv(Buffer.from(templateCsv(), 'utf8')));
  assert.equal(template.products.length, 2);
  assert.equal(template.products[0].images.length, 2);
  assert.equal(template.products[0].description, 'Over-ear Bluetooth headphones with active noise cancelling.\n\nUSB-C fast charging and a soft carry case.');
  assert.equal(template.products[1].category, 'food');

  const long = readProductFile(`name,price,days,min_buyers\n${'Very long name '.repeat(20)},5,45,0\n`).products[0];
  assert.ok(long.name.length <= 120);
  assert.match(long.notes.join(' '), /shortened/);
  assert.equal(long.days, null, 'more than 30 days is ignored');
  assert.equal(long.minBuyers, null);
  assert.throws(() => readProductFile('name,price\n'), /no products/);
});

// ---------------------------------------------------------------------------------------------
// Copying photos

test('photo downloads only reach public addresses', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '151.101.1.1', '2a00:1450:4001::1', '::ffff:8.8.8.8']) assert.equal(isPrivateAddress(ip), false, ip);

  for (const url of ['http://localhost/a.jpg', 'http://127.0.0.1/a.jpg', 'http://[::1]/a.jpg', 'http://169.254.169.254/latest', 'ftp://x.test/a.jpg', 'https://user:pw@x.test/a.jpg', 'https://x.test:8443/a.jpg', 'http://shop.localhost/a.jpg']) {
    await assert.rejects(downloadImage(url), /public|http|password|port/, url);
  }
});

test('downloads follow redirects, check the image type and stop at the size limit', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/photo.png') return res.end(PNG);
    if (req.url === '/moved') return res.writeHead(302, { Location: '/photo.png' }).end();
    if (req.url === '/page') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html>not an image</html>');
    if (req.url === '/huge') return res.writeHead(200, { 'Content-Length': String(20 * 1024 * 1024) }).end();
    res.writeHead(404).end();
  });
  server.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const opts = { allowPrivate: true }; // the test server is on this machine
  assert.deepEqual(await downloadImage(`${base}/photo.png`, opts), PNG);
  assert.deepEqual(await downloadImage(`${base}/moved`, opts), PNG);
  await assert.rejects(downloadImage(`${base}/page`, opts), /not a JPG/);
  await assert.rejects(downloadImage(`${base}/huge`, opts), /larger than/);
  await assert.rejects(downloadImage(`${base}/missing`, opts), /answered 404/);
  // Without allowPrivate the same server is refused.
  await assert.rejects(downloadImage(`${base}/photo.png`), /public|port/);
});

test('the photo queue copies photos in order and records failures', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-import-photos-'));
  const repo = createRepo(openDb(path.join(dir, 'db.sqlite')));
  const deal = repo.insertDeal({ slug: 'lamp-1', product_name: 'Lamp', description: '', image_url: '', price_cents: 900, tax_code: 'txcd_99999999', min_buyers: 2, deadline: new Date(Date.now() + 86400000).toISOString(), created_at: new Date().toISOString() });
  const files = { 'https://x.test/1.png': PNG, 'https://x.test/2.jpg': JPG };
  const download = async (url) => {
    await new Promise((r) => setTimeout(r, url.endsWith('1.png') ? 20 : 0)); // the first one is slower
    if (!files[url]) throw new ImageFetchError('the other site answered 404');
    return files[url];
  };
  const importer = createImageImporter({ photos: createPhotoStore(path.join(dir, 'uploads')), repo, clock: systemClock, download, log: {} });
  importer.enqueue(deal.id, ['https://x.test/1.png', 'https://x.test/missing.jpg', 'https://x.test/2.jpg', 'https://x.test/1.png', 'https://x.test/4.png'], 3);
  await importer.idle();
  const photos = repo.photosForDeal(deal.id);
  assert.deepEqual(photos.map((p) => path.extname(p.filename)), ['.png', '.jpg'], 'saved in the order of the file');
  const stats = importer.stats();
  assert.equal(stats.photosQueued, 3, 'duplicates removed, at most 3 per deal');
  assert.equal(stats.photosCopied, 2);
  assert.equal(stats.photosFailed, 1);
  assert.equal(stats.failures[0].reason, 'the other site answered 404');
  assert.equal(stats.busy, false);
});

// ---------------------------------------------------------------------------------------------
// The admin pages

async function startApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-import-'));
  const config = {
    baseUrl: 'https://shop.test', adminUser: 'admin', adminPassword: 'secret-pw', appSecret: 'test-secret-0123456789abcdef',
    defaultTaxCode: 'txcd_99999999', uploadDir: path.join(dir, 'uploads'), trustProxy: false,
    business: { name: '[Your company name]', address: '[Street]', email: '[contact@example.com]', vatId: '[EU VAT number]', registration: '[Register]', supervisoryAuthority: '[DPA]' },
  };
  const repo = createRepo(openDb(path.join(dir, 'db.sqlite')));
  const copied = [];
  const imageImporter = { enqueue: (dealId, urls, n) => copied.push({ dealId, urls, n }), stats: () => ({ photosQueued: 0, failures: [] }) };
  const ctx = { config, repo, clock: systemClock, photos: createPhotoStore(config.uploadDir), imageImporter, routes: [publicRoutes, adminRoutes] };
  const server = createApp(ctx).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:secret-pw').toString('base64') };
  const csrf = hmac(config.appSecret, 'admin-csrf');
  const upload = (csv, fields = {}, token = csrf) => {
    const form = new FormData();
    form.append('_csrf', token);
    for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'products.csv');
    return fetch(`${base}/admin/import`, { method: 'POST', headers: auth, body: form });
  };
  const confirm = (fields) =>
    fetch(`${base}/admin/import/confirm`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, ...fields }),
    });
  return { base, auth, repo, upload, confirm, copied, close: () => server.close() };
}

const tokenOf = (html) => html.match(/name="token" value="([^"]+)"/)?.[1];

test('admin import: upload, preview, publish the ticked products', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const page = await (await fetch(`${app.base}/admin/import`, { headers: app.auth })).text();
  assert.match(page, /Import products[\s\S]*Download the template/);
  assert.match(await (await fetch(`${app.base}/admin`, { headers: app.auth })).text(), /href="\/admin\/import"/);
  const template = await fetch(`${app.base}/admin/import/template.csv`, { headers: app.auth });
  assert.match(template.headers.get('content-type'), /text\/csv/);
  const bytes = Buffer.from(await template.arrayBuffer());
  assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf', 'BOM, so Excel reads it as UTF-8');
  assert.match(bytes.toString('utf8', 3), /^name,headline,description,price/);

  // An existing open deal with the same name is flagged and left unticked.
  app.repo.insertDeal({ slug: 'mug-1', product_name: 'Ceramic mug', description: '', image_url: '', price_cents: 900, tax_code: 'txcd_99999999', min_buyers: 2, deadline: new Date(Date.now() + 86400000).toISOString(), created_at: new Date().toISOString() });

  const csv = [
    'name,description,price,image_urls,category,min_buyers,days',
    '"Oak desk lamp","<p>Warm light.</p>",49.00,"https://cdn.test/lamp-1.jpg https://cdn.test/lamp-2.jpg",Lighting,,',
    'Ceramic mug,Holds 350 ml,12.00,,home,,',
    'Mystery box,No price,,,,,',
    'Running shoes,Light trail shoes,80.00,https://cdn.test/shoe.jpg,sports,25,3',
  ].join('\n');
  const res = await app.upload(csv, { discount: 10, min_buyers: 8, days: 5, photos: 2, category: 'other' });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Preview: 4 products/);
  assert.match(html, /Read from a <strong>spreadsheet<\/strong>/);
  assert.match(html, /name="price_0" value="44.10"/, '10% off 49.00');
  assert.match(html, /File: 49.00/);
  assert.match(html, /name="include_0" value="1"[^>]*checked/);
  assert.doesNotMatch(html, /name="include_1" value="1"[^>]*checked/, 'already in the shop');
  assert.match(html, /already in your shop/);
  assert.doesNotMatch(html, /name="include_2" value="1"[^>]*checked/, 'no price');
  assert.match(html, /No price in the file/);
  assert.match(html, /name="min_0" value="8"/);
  assert.match(html, /name="min_3" value="25"/, "the row's own minimum wins");
  assert.match(html, /<option value="sports" selected>/);
  const token = tokenOf(html);
  assert.ok(token);

  const done = await app.confirm({
    token,
    include_0: '1', name_0: 'Oak desk lamp', price_0: '44.10', min_0: '8', cat_0: 'home',
    include_2: '1', name_2: 'Mystery box', price_2: '', min_2: '8', cat_2: 'other',
    include_3: '1', name_3: 'Trail running shoes', price_3: '72,00', min_3: '25', cat_3: 'sports',
  });
  assert.equal(done.status, 200);
  const doneHtml = await done.text();
  assert.match(doneHtml, /2 deals published/);
  assert.match(doneHtml, /Mystery box<\/strong>: Enter a price/);

  const deals = app.repo.listDeals().filter((d) => d.slug !== 'mug-1');
  const lamp = deals.find((d) => d.product_name === 'Oak desk lamp');
  const shoes = deals.find((d) => d.product_name === 'Trail running shoes');
  assert.equal(lamp.price_cents, 4410);
  assert.equal(lamp.category, 'home');
  assert.equal(lamp.description, 'Warm light.');
  assert.equal(lamp.image_url, 'https://cdn.test/lamp-1.jpg', 'shown until the photos are copied');
  assert.equal(lamp.status, 'open');
  assert.equal(shoes.price_cents, 7200);
  assert.equal(shoes.min_buyers, 25);
  const days = (d) => (new Date(d.deadline) - Date.now()) / 86400000;
  assert.ok(days(lamp) > 4.9 && days(lamp) <= 5, 'the default 5 days, on the hour');
  assert.ok(days(shoes) > 2.9 && days(shoes) <= 3, "the row's own 3 days");
  assert.deepEqual(app.copied.map((c) => [c.dealId, c.urls.length, c.n]), [[lamp.id, 2, 2], [shoes.id, 1, 2]]);

  // The deals are on the shop's home page.
  const home = await (await fetch(app.base + '/')).text();
  assert.match(home, /Oak desk lamp/);
  assert.match(home, /Trail running shoes/);

  // A preview can only be published once.
  const again = await app.confirm({ token, include_0: '1', name_0: 'Oak desk lamp', price_0: '44.10', min_0: '8', cat_0: 'home' });
  assert.equal(again.status, 410);
  assert.match(await again.text(), /expired or was already published/);
});

test('admin import: bad files and missing form tokens are refused', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const noName = await app.upload('sku,price\nA-1,9\n');
  assert.equal(noName.status, 422);
  assert.match(await noName.text(), /no product name column/);
  const empty = await app.upload('name,price\n');
  assert.equal(empty.status, 422);
  const forged = await app.upload('name,price\nLamp,9\n', {}, 'wrong-token');
  assert.equal(forged.status, 403);
  const unauth = await fetch(`${app.base}/admin/import`);
  assert.equal(unauth.status, 401);
  assert.equal(app.repo.listDeals().length, 0);
});
