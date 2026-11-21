import { photoUrl } from './photos.js';
import { isPlaceholder } from './businessSettings.js';

// What a page tells search engines and link previews (WhatsApp, Facebook, Instagram, X …):
// res.locals.meta = { type, title, description, image, priceAmount, jsonLd }, written into the
// page head by views/partials/header.ejs.

const plain = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// At most `max` characters, cut at a space.
export function shorten(text, max = 200) {
  const s = plain(text);
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

const organization = (business, baseUrl) =>
  isPlaceholder(business?.name)
    ? undefined
    : { '@type': 'Organization', name: business.name, url: baseUrl, ...(isPlaceholder(business.email) ? {} : { email: business.email }) };

// A deal page: its cover photo and price in the preview, and schema.org Product data so search
// engines can show the price.
export function dealMeta({ deal, photos = [], state, baseUrl, lang, business, categoryName, formatEuro }) {
  const images = photos.map((p) => baseUrl + photoUrl(p.filename));
  if (!images.length && /^https:\/\//.test(deal.image_url || '')) images.push(deal.image_url);
  const description = shorten([deal.headline, deal.description].filter(Boolean).join(' – ')) || plain(deal.product_name);
  const seller = organization(business, baseUrl);
  return {
    type: 'product',
    title: `${deal.product_name} – ${formatEuro(deal.price_cents)}`,
    description,
    image: images[0] ?? '',
    priceAmount: (deal.price_cents / 100).toFixed(2),
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: plain(deal.product_name),
      description: shorten(deal.description || deal.headline || deal.product_name, 5000),
      ...(images.length ? { image: images } : {}),
      sku: deal.slug,
      ...(categoryName ? { category: categoryName } : {}),
      offers: {
        '@type': 'Offer',
        url: `${baseUrl}/deals/${deal.slug}?lang=${lang}`,
        priceCurrency: 'EUR',
        price: (deal.price_cents / 100).toFixed(2),
        priceValidUntil: new Date(deal.deadline).toISOString().slice(0, 10),
        availability: state?.joinable ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        ...(seller ? { seller } : {}),
      },
    },
  };
}

// The home page: the slogan, and the first deal photo as the preview picture.
export function homeMeta({ t, cover, baseUrl, business }) {
  const org = organization(business, baseUrl);
  return {
    type: 'website',
    title: `${t('home.heroLine1')} ${t('home.heroLine2')}`,
    description: shorten(t('home.lead')),
    image: cover ? baseUrl + photoUrl(cover.filename) : '',
    jsonLd: org ? { '@context': 'https://schema.org', ...org } : null,
  };
}
