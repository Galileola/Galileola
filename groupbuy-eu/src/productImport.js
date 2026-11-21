import { allCategories, isCategory } from './categories.js';
import { parseEuroToCents } from './util.js';
import { shorten } from './seo.js';
import { MAX_HEADLINE } from './deals.js';

// Product import (Admin → Import products): reads a CSV file exported from another shop and turns
// each product into a draft deal for the preview. Understands:
//   - Shopify product exports (one row per variant or extra image, grouped by Handle)
//   - WooCommerce product exports (variations are folded into their parent product)
//   - any simple spreadsheet with a header row (name, price, description, images, …), including
//     this shop's own template (/admin/import/template.csv)
// Nothing here touches the database: the admin route validates and creates the deals.

export const MAX_IMPORT_PRODUCTS = 300;
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_NAME = 120;
export const MAX_DESCRIPTION = 5000;

export class ImportError extends Error {}

// ---------------------------------------------------------------------------------------------
// CSV

// The bytes of an uploaded file as text: UTF-8 (with or without BOM), else Windows-1252, which is
// what older Excel versions save.
export function decodeCsv(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

// The separator used in the header line: comma, semicolon (Excel in most EU countries) or tab.
function detectDelimiter(text) {
  let firstLine = '';
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if ((ch === '\n' || ch === '\r') && !quoted) break;
    if (!quoted) firstLine += ch;
  }
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

// RFC 4180 CSV: quoted fields, "" inside quotes, line breaks inside quotes, CRLF / LF / CR.
// Returns an array of rows (arrays of strings). Rows that are completely empty are dropped.
export function parseCsv(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      field = '';
      quoted = true;
    } else if (ch === delimiter) endField();
    else if (ch === '\r' || ch === '\n') {
      endRow();
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
    } else field += ch;
    i += 1;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Text helpers

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', euro: '€', pound: '£',
  copy: '©', reg: '®', trade: '™', deg: '°', times: '×', bull: '•', middot: '·', eacute: 'é',
  egrave: 'è', agrave: 'à', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
};

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code] ?? NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

// Product descriptions from other shops are often HTML. The deal page shows plain paragraphs
// (separated by a blank line), so tags are turned into line breaks and removed.
export function htmlToText(input) {
  let s = String(input ?? '');
  if (/<[a-z!/][^>]*>/i.test(s)) {
    s = s
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|iframe|noscript)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/\r?\n/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<\/(p|div|h[1-6]|ul|ol|table|tr|section|article|blockquote)\s*>/gi, '\n\n')
      .replace(/<(p|div|h[1-6]|ul|ol|table|tr|section|article|blockquote)\b[^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, '');
  }
  return decodeEntities(s)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(^|\n)- (?=\n|$)/g, '$1')
    .trim();
}

const oneLine = (s) => htmlToText(s).replace(/\s+/g, ' ').trim();

// Every http(s) address in a cell. Cells may hold one URL or several, separated by commas,
// semicolons, pipes, spaces or line breaks.
export function extractImageUrls(cell) {
  const out = [];
  for (const m of String(cell ?? '').matchAll(/https?:\/\/[^\s,;|"'<>]+/gi)) {
    const url = m[0].replace(/[).\]]+$/, '');
    try {
      const u = new URL(url);
      if (!out.includes(u.href)) out.push(u.href);
    } catch {
      /* not a URL */
    }
  }
  return out;
}

// A price as written in another shop's file: "49.00", "49,00", "1.299,00", "€ 49", "49.00 EUR".
export function parseSourcePrice(text) {
  const cleaned = String(text ?? '')
    .replace(/\b(eur|euro|euros)\b/gi, '')
    .replace(/[€\s ]/g, '')
    .trim();
  if (!cleaned) return NaN;
  const cents = parseEuroToCents(cleaned);
  if (Number.isFinite(cents)) return cents;
  // "49.9" or "49.990" style values with more decimals: round to cents.
  if (/^\d+\.\d+$/.test(cleaned)) return Math.round(Number(cleaned) * 100);
  return NaN;
}

const truthy = (v) => /^(1|true|yes|y|ja|oui|si|sí|active|published|publish|visible)$/i.test(String(v ?? '').trim());
const falsy = (v) => /^(0|-1|false|no|n|nein|non|draft|archived|private|hidden)$/i.test(String(v ?? '').trim());

// ---------------------------------------------------------------------------------------------
// Categories

const words = (s) =>
  ` ${String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;

// Words other shops use for the built-in categories (Shopify's and Google's product taxonomies,
// WooCommerce category names), on top of each category's names and hint words.
const EXTRA_KEYWORDS = {
  electronics: 'electronic, phone, smartphone, laptop, tablet, computer, headphone, earbud, speaker, camera, charger, cable, smartwatch, tv, console',
  home: 'home & garden, furniture, kitchen, cookware, lighting, lamp, decor, bedding, bath, household, appliance, mug, tableware',
  fashion: 'apparel, clothing, clothes, shirt, t-shirt, tee, hoodie, sweater, dress, jacket, jeans, trousers, sneaker, shoe, footwear, handbag, luggage, bag, jewelry, jewellery, watch, sunglasses',
  beauty: 'health & beauty, cosmetic, makeup, skincare, skin care, haircare, fragrance, perfume, personal care, vitamin, supplement',
  sports: 'sporting goods, sport, fitness, gym, yoga, cycling, bicycle, camping, hiking, outdoor, running',
  kids: 'toys & games, toy, baby, toddler, kid, child, children, nursery',
  food: 'food, beverage, drink, grocery, snack, coffee, tea, chocolate, wine, beer',
  garden: 'hardware, tool, power tool, diy, plant, seed, lawn, patio',
  pets: 'animals & pet supplies, pet, dog, cat, aquarium, bird',
  hobbies: 'arts & entertainment, media, book, craft, art supplies, music, instrument, board game, puzzle, collectible, stationery',
  auto: 'vehicles & parts, vehicle, car, motorbike, motorcycle, automotive, tyre, tire',
};

// The shop category that best matches a free-text category, product type or tags from another
// shop ("Clothing > Hoodies", "Headphones"), or '' when nothing matches. Uses each category's
// names in every language and its hint words ("phones, computers, audio …").
export function guessCategory(text, categories = allCategories()) {
  const haystack = words(text);
  if (!haystack.trim()) return '';
  let best = '';
  let bestScore = 0;
  for (const c of categories) {
    if (c.slug === 'other') continue;
    let score = 0;
    const names = [c.name, c.slug, ...Object.values(c.names ?? {})].filter(Boolean);
    for (const name of names) {
      const parts = words(name).trim().split(' ').filter((w) => w.length > 2 && w !== 'and');
      if (haystack.includes(words(name))) score += 3;
      else for (const w of parts) if (haystack.includes(` ${w} `) || haystack.includes(` ${w}s `)) score += 1;
    }
    const keywords = [...String(c.hint ?? '').split(','), ...(c.builtIn ? (EXTRA_KEYWORDS[c.slug] ?? '').split(',') : [])];
    for (const hint of keywords) {
      const h = words(hint).trim();
      if (!h) continue;
      const singular = h.replace(/(ies)$/, 'y').replace(/(es|s)$/, '');
      if (haystack.includes(` ${h} `) || (singular.length > 2 && haystack.includes(` ${singular} `))) score += 2;
    }
    if (score > bestScore) {
      best = c.slug;
      bestScore = score;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Columns

// Header names are compared without case, spaces, punctuation or accents: "Product Name",
// "product_name" and "PRODUCT-NAME" are the same column.
const key = (h) =>
  String(h ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const ALIASES = {
  name: ['name', 'productname', 'product', 'title', 'producttitle', 'itemname', 'item', 'productname1'],
  description: ['description', 'bodyhtml', 'body', 'longdescription', 'productdescription', 'details', 'descriptionhtml', 'content'],
  headline: ['headline', 'shortdescription', 'tagline', 'subtitle', 'summary', 'excerpt'],
  price: ['groupprice', 'dealprice', 'price', 'variantprice', 'saleprice', 'regularprice', 'priceeur', 'retailprice', 'listprice'],
  category: ['category', 'categories', 'productcategory', 'type', 'producttype', 'department'],
  tags: ['tags', 'keywords'],
  minBuyers: ['minbuyers', 'minimumbuyers', 'minimum', 'min', 'buyersneeded', 'groupsize'],
  days: ['days', 'deadlinedays', 'durationdays', 'duration', 'runsfordays', 'dealdays'],
  taxCode: ['taxcode', 'stripetaxcode', 'varianttaxcode'],
  id: ['handle', 'sku', 'id', 'productid', 'variantsku'],
  status: ['status', 'published', 'visibility', 'active'],
};

// Index of the first header that matches one of `names`, in the order of `names`.
function findColumn(keys, names) {
  for (const n of names) {
    const i = keys.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

const isImageHeader = (k) =>
  /^(image|images|imageurl|imageurls|imagesrc|imagelink|img|photo|photos|photourl|picture|pictures|mainimage|additionalimages|additionalimagelink|variantimage|imageurl\d+|image\d+|photo\d+|picture\d+|images\d+)$/.test(k);

function detectFormat(keys) {
  if (keys.includes('handle') && (keys.includes('variantprice') || keys.includes('bodyhtml'))) return 'shopify';
  if (keys.includes('regularprice') && (keys.includes('parent') || keys.includes('type')) && keys.includes('name')) return 'woocommerce';
  return 'spreadsheet';
}

export const FORMAT_LABELS = {
  shopify: 'Shopify product export',
  woocommerce: 'WooCommerce product export',
  spreadsheet: 'spreadsheet',
};

// ---------------------------------------------------------------------------------------------
// Reading a file

// Returns { format, products, skipped, total } where each product is
//   { line, name, headline, description, priceCents (NaN if unreadable), priceText, images[],
//     category (slug or ''), categoryText, minBuyers (or null), days (or null), taxCode,
//     sourceId, hidden (draft/unpublished in the other shop), notes[] }
// and `skipped` lists rows that couldn't be used: { line, reason }.
export function readProductFile(text, { categories = allCategories() } = {}) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new ImportError('The file has no products: it needs a header row and at least one product row.');
  const header = rows[0];
  const keys = header.map(key);
  const format = detectFormat(keys);
  const col = Object.fromEntries(Object.entries(ALIASES).map(([field, names]) => [field, findColumn(keys, names)]));
  if (col.name < 0) {
    throw new ImportError(
      `There is no product name column. Name one column "name" (or "title" or "product"). The file's columns are: ${header
        .slice(0, 12)
        .map((h) => `"${h}"`)
        .join(', ')}${header.length > 12 ? ' …' : ''}.`
    );
  }
  const imageCols = keys.map((k, i) => (isImageHeader(k) ? i : -1)).filter((i) => i >= 0);
  const cell = (row, i) => (i >= 0 ? String(row[i] ?? '').trim() : '');
  const records = rows.slice(1).map((row, i) => ({ row, line: i + 2 }));

  let products;
  const skipped = [];
  if (format === 'shopify') products = readShopify(records, keys, cell, imageCols, skipped);
  else if (format === 'woocommerce') products = readWoo(records, keys, col, cell, imageCols, skipped);
  else products = readSpreadsheet(records, col, cell, imageCols, skipped);

  for (const p of products) finishProduct(p, categories);
  if (!products.length) throw new ImportError('No products were found in the file.');
  const total = products.length;
  if (products.length > MAX_IMPORT_PRODUCTS) products = products.slice(0, MAX_IMPORT_PRODUCTS);
  return { format, products, skipped, total };
}

function readSpreadsheet(records, col, cell, imageCols, skipped) {
  const products = [];
  for (const { row, line } of records) {
    const name = oneLine(cell(row, col.name));
    if (!name) {
      skipped.push({ line, reason: 'no product name' });
      continue;
    }
    const status = cell(row, col.status);
    products.push({
      line,
      name,
      headline: cell(row, col.headline),
      description: cell(row, col.description),
      priceText: cell(row, col.price),
      images: imageCols.flatMap((i) => extractImageUrls(row[i])),
      categoryText: [cell(row, col.category), cell(row, col.tags)].filter(Boolean).join(' '),
      minBuyersText: cell(row, col.minBuyers),
      daysText: cell(row, col.days),
      taxCode: cell(row, col.taxCode),
      sourceId: cell(row, col.id),
      hidden: Boolean(status) && falsy(status),
      notes: [],
    });
  }
  return products;
}

// Shopify: the first row of a product has the title and description; following rows with the same
// Handle add variants (sizes, colours) and more images.
function readShopify(records, keys, cell, imageCols, skipped) {
  const c = (name) => keys.indexOf(name);
  const byHandle = new Map();
  for (const { row, line } of records) {
    const handle = cell(row, c('handle'));
    if (!handle) {
      skipped.push({ line, reason: 'no Handle' });
      continue;
    }
    let p = byHandle.get(handle);
    if (!p) {
      p = { line, sourceId: handle, name: '', headline: '', description: '', priceText: '', images: [], positions: [],
        categoryText: '', taxCode: '', hidden: false, variants: 0, notes: [], minBuyersText: '', daysText: '' };
      byHandle.set(handle, p);
    }
    const title = cell(row, c('title'));
    if (title && !p.name) {
      p.name = oneLine(title);
      p.description = cell(row, c('bodyhtml'));
      p.categoryText = [cell(row, c('productcategory')), cell(row, c('type')), cell(row, c('tags'))].filter(Boolean).join(' ');
      const status = cell(row, c('status'));
      const published = cell(row, c('published'));
      p.hidden = Boolean((status && !/^active$/i.test(status)) || (published && falsy(published)));
    }
    const price = cell(row, c('variantprice'));
    if (price) {
      p.variants += 1;
      if (!p.priceText) {
        p.priceText = price;
        p.taxCode = cell(row, c('varianttaxcode'));
      }
    }
    const position = Number(cell(row, c('imageposition'))) || 1000 + p.images.length;
    for (const i of imageCols) {
      for (const url of extractImageUrls(row[i])) {
        if (!p.images.includes(url)) {
          p.images.push(url);
          p.positions.push(keys[i] === 'imagesrc' ? position : 2000 + p.images.length);
        }
      }
    }
  }
  const products = [];
  for (const p of byHandle.values()) {
    if (!p.name) {
      skipped.push({ line: p.line, reason: `no Title for "${p.sourceId}"` });
      continue;
    }
    p.images = p.images.map((url, i) => [url, p.positions[i]]).sort((a, b) => a[1] - b[1]).map(([url]) => url);
    if (p.variants > 1) p.notes.push(`${p.variants} variants in the file: the first one's price is used, and buyers can't choose a size or colour.`);
    delete p.positions;
    delete p.variants;
    products.push(p);
  }
  return products;
}

// WooCommerce: "variation" rows belong to a "variable" parent (Parent = id:123 or its SKU). The
// parent gets the lowest variation price. Sale price wins over regular price.
function readWoo(records, keys, col, cell, imageCols, skipped) {
  const c = (name) => keys.indexOf(name);
  const typeOf = (row) => cell(row, c('type')).toLowerCase();
  const priceOf = (row) => cell(row, c('saleprice')) || cell(row, c('regularprice'));
  const products = [];
  const byRef = new Map();
  const variations = [];
  for (const { row, line } of records) {
    const type = typeOf(row);
    if (/\bvariation\b/.test(type)) {
      variations.push({ row, line });
      continue;
    }
    const name = oneLine(cell(row, c('name')));
    if (!name) {
      skipped.push({ line, reason: 'no Name' });
      continue;
    }
    if (/\b(grouped|external)\b/.test(type)) {
      skipped.push({ line, reason: `"${name}" is a ${type.includes('grouped') ? 'grouped' : 'external'} product` });
      continue;
    }
    const published = cell(row, c('published'));
    const p = {
      line,
      name,
      headline: cell(row, c('shortdescription')),
      description: cell(row, c('description')),
      priceText: priceOf(row),
      images: imageCols.flatMap((i) => extractImageUrls(row[i])),
      categoryText: [cell(row, c('categories')), cell(row, c('tags'))].filter(Boolean).join(' '),
      taxCode: '',
      sourceId: cell(row, c('sku')) || cell(row, c('id')),
      hidden: Boolean(published) && falsy(published),
      notes: [],
      minBuyersText: cell(row, col.minBuyers),
      daysText: cell(row, col.days),
      variants: 0,
    };
    products.push(p);
    const id = cell(row, c('id'));
    const sku = cell(row, c('sku'));
    if (id) byRef.set(`id:${id}`, p);
    if (sku) byRef.set(sku, p);
  }
  for (const { row, line } of variations) {
    const parent = byRef.get(cell(row, c('parent')));
    if (!parent) {
      skipped.push({ line, reason: 'a variation whose parent product is not in the file' });
      continue;
    }
    parent.variants += 1;
    const cents = parseSourcePrice(priceOf(row));
    const current = parseSourcePrice(parent.priceText);
    if (Number.isFinite(cents) && (!Number.isFinite(current) || cents < current)) parent.priceText = priceOf(row);
    for (const i of imageCols) for (const url of extractImageUrls(row[i])) if (!parent.images.includes(url)) parent.images.push(url);
  }
  for (const p of products) {
    if (p.variants > 1) p.notes.push(`${p.variants} variations in the file: the lowest price is used, and buyers can't choose a size or colour.`);
    delete p.variants;
  }
  return products;
}

function finishProduct(p, categories) {
  const fullName = p.name;
  p.name = shorten(fullName, MAX_NAME);
  if (p.name !== fullName) p.notes.push('Name shortened to 120 characters.');
  p.description = htmlToText(p.description);
  if (p.description.length > MAX_DESCRIPTION) {
    p.description = shorten(p.description.replace(/\n/g, '\u0000'), MAX_DESCRIPTION).replace(/\u0000/g, '\n');
    p.notes.push('Description shortened to 5,000 characters.');
  }
  const headline = oneLine(p.headline);
  p.headline = headline === p.description.replace(/\s+/g, ' ').trim() ? '' : shorten(headline, MAX_HEADLINE);
  p.priceCents = parseSourcePrice(p.priceText);
  if (!p.priceText) p.notes.push('No price in the file.');
  else if (!Number.isFinite(p.priceCents)) p.notes.push(`The price "${p.priceText}" could not be read.`);
  const slug = p.categoryText.trim().toLowerCase();
  p.category = isCategory(slug) ? slug : guessCategory(p.categoryText, categories) || guessCategory(p.name, categories);
  const min = Number(p.minBuyersText);
  p.minBuyers = Number.isInteger(min) && min >= 1 && min <= 10_000 ? min : null;
  const days = Number(p.daysText);
  p.days = Number.isFinite(days) && days > 0 && days <= 30 ? days : null;
  p.taxCode = /^txcd_\d{8}$/.test(p.taxCode) ? p.taxCode : '';
  if (p.hidden) p.notes.push('Not published in the other shop (draft, private or archived).');
  delete p.minBuyersText;
  delete p.daysText;
  return p;
}

// The group price from the file's price and the admin's discount (percent off), in cents.
export function groupPrice(priceCents, discountPercent) {
  if (!Number.isFinite(priceCents)) return NaN;
  const pct = Math.min(90, Math.max(0, Number(discountPercent) || 0));
  return Math.round((priceCents * (100 - pct)) / 100);
}

// Normalised product name, for spotting products that are already in the shop.
export const nameKey = (name) => words(name).trim();

// The template offered for download: this shop's own columns, with two example rows.
export function templateCsv() {
  const rows = [
    ['name', 'headline', 'description', 'price', 'min_buyers', 'days', 'category', 'image_urls'],
    [
      'Noise-cancelling wireless headphones',
      'Studio sound and a 40-hour battery',
      'Over-ear Bluetooth headphones with active noise cancelling.\n\nUSB-C fast charging and a soft carry case.',
      '79.00',
      '20',
      '7',
      'electronics',
      'https://example.com/photos/headphones-1.jpg https://example.com/photos/headphones-2.jpg',
    ],
    ['Single-origin coffee beans 1 kg', 'Fresh roast from a small EU roaster', 'Medium roast, whole beans.', '24.50', '10', '14', 'food', ''],
  ];
  const q = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}
