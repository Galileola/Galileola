import { safeFetch } from './net.js';

// Reads the product list of an online shop: Shopify and WooCommerce shops
// publish it without a key. Other shops can export a CSV file.

function clean(html, max = 400) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, '’')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function absolute(src, base) {
  if (!src) return null;
  try {
    return new URL(src.startsWith('//') ? `https:${src}` : src, base).toString();
  } catch {
    return null;
  }
}

async function json(url) {
  const { buffer } = await safeFetch(url, { maxBytes: 10_000_000, accept: 'application/json' });
  return JSON.parse(buffer.toString('utf8'));
}

async function shopify(origin) {
  const data = await json(`${origin}/products.json?limit=250`);
  if (!Array.isArray(data?.products)) return null;
  return data.products.map((p) => ({
    id: `shopify-${p.id}`,
    title: clean(p.title, 120),
    description: clean(p.body_html),
    price: p.variants?.[0]?.price ? String(p.variants[0].price) : '',
    image: absolute(p.images?.[0]?.src || p.image?.src, origin),
    url: p.handle ? `${origin}/products/${p.handle}` : '',
  }));
}

async function woocommerce(origin) {
  const data = await json(`${origin}/wp-json/wc/store/v1/products?per_page=100`);
  if (!Array.isArray(data)) return null;
  return data.map((p) => {
    const unit = p.prices?.currency_minor_unit ?? 2;
    const price = p.prices?.price ? (Number(p.prices.price) / 10 ** unit).toFixed(unit) : '';
    return {
      id: `woo-${p.id}`,
      title: clean(p.name, 120),
      description: clean(p.short_description || p.description),
      price: price ? `${price}${p.prices?.currency_code ? ` ${p.prices.currency_code}` : ''}` : '',
      image: absolute(p.images?.[0]?.src, origin),
      url: p.permalink || '',
    };
  });
}

/** Reads products from a shop address. Returns { source, products }. */
export async function readShop(address) {
  const raw = /^https?:\/\//i.test(address) ? address : `https://${address}`;
  const origin = new URL(raw).origin;
  for (const [source, reader] of [['Shopify', shopify], ['WooCommerce', woocommerce]]) {
    try {
      const products = await reader(origin);
      if (products?.length) return { source, products: products.filter((p) => p.image && p.title) };
    } catch (err) {
      if (err.userMessage) throw err;
    }
  }
  throw Object.assign(new Error('Unknown shop'), {
    userMessage: 'Couldn’t read the products from this shop. Shopify and WooCommerce shops work directly; for other shops, export the products as a CSV file.',
  });
}

function splitCsvLine(line, sep) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

/**
 * Reads products from CSV text. Needs a header row with a name column
 * (name, title, product) and an image column (image, image url, photo);
 * price and description are optional. Commas or semicolons both work.
 */
export function parseCsv(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw Object.assign(new Error('Empty CSV'), { userMessage: 'The CSV file has no products.' });
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const header = splitCsvLine(lines[0], sep).map((h) => h.toLowerCase());
  const col = (...names) => header.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const name = col('name', 'title', 'product', 'nimi', 'название');
  const image = col('image', 'photo', 'picture', 'pilt', 'фото', 'изображение');
  const price = col('price', 'hind', 'цена');
  const desc = col('description', 'kirjeldus', 'описание');
  if (name < 0 || image < 0) throw Object.assign(new Error('Missing columns'), { userMessage: 'The CSV needs a “name” column and an “image” column (a link to the product photo).' });
  return lines.slice(1).map((line, i) => {
    const cells = splitCsvLine(line, sep);
    return {
      id: `csv-${i + 1}`,
      title: clean(cells[name], 120),
      description: desc >= 0 ? clean(cells[desc]) : '',
      price: price >= 0 ? cells[price] || '' : '',
      image: cells[image] || null,
      url: '',
    };
  }).filter((p) => p.title && p.image).slice(0, 500);
}
