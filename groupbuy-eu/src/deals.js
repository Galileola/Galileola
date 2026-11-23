import { MAX_DEAL_DURATION_MS, parseEuroToCents, slugify, iso } from './util.js';
import { DEFAULT_CATEGORY, isCategory } from './categories.js';
import { DEFAULT_DIGITAL_TAX_CODE, KINDS } from './digital.js';

export const MAX_HEADLINE = 120;
export const MAX_SOCIAL_POST = 2000;
export const MAX_SEO_TITLE = 120;
export const MAX_SEO_DESCRIPTION = 300;

const MIN_LEAD_MS = 2 * 60 * 1000; // deadline at least 2 minutes out (short deadlines help testing)

// Validates the admin "new deal" form. Returns { errors, deal } where deal is ready to insert.
export function validateDealInput(body, { now, defaultTaxCode }) {
  const errors = {};
  const product_name = String(body.product_name ?? '').trim();
  // Multipart forms send line breaks as \r\n: store plain \n so paragraphs split correctly.
  const description = String(body.description ?? '').replace(/\r\n?/g, '\n').trim();
  const image_url = String(body.image_url ?? '').trim();
  const headline = String(body.headline ?? '').replace(/\s+/g, ' ').trim();
  const social_post = String(body.social_post ?? '').replace(/\r\n?/g, '\n').trim();
  const category = String(body.category ?? '').trim() || DEFAULT_CATEGORY;
  // goods (delivered) or digital (downloads, sold only in Estonia: src/digital.js).
  const kind = String(body.kind ?? '').trim() || 'goods';
  const tax_code = String(body.tax_code ?? '').trim() || (kind === 'digital' ? DEFAULT_DIGITAL_TAX_CODE : defaultTaxCode);
  const price_cents = parseEuroToCents(body.price);
  const min_buyers = Number(body.min_buyers);

  if (!product_name) errors.product_name = 'Enter a product name.';
  else if (product_name.length > 120) errors.product_name = 'Keep the name under 120 characters.';
  if (description.length > 5000) errors.description = 'Keep the description under 5,000 characters.';
  if (headline.length > MAX_HEADLINE) errors.headline = `Keep the headline under ${MAX_HEADLINE} characters.`;
  if (social_post.length > MAX_SOCIAL_POST) errors.social_post = `Keep the social media post under ${MAX_SOCIAL_POST} characters.`;
  if (!isCategory(category)) errors.category = 'Choose a category from the list.';
  if (!KINDS.includes(kind)) errors.kind = 'Choose physical goods or a digital download.';
  const seo_title = String(body.seo_title ?? '').replace(/\s+/g, ' ').trim();
  const seo_description = String(body.seo_description ?? '').replace(/\s+/g, ' ').trim();
  if (seo_title.length > MAX_SEO_TITLE) errors.seo_title = `Keep the search title under ${MAX_SEO_TITLE} characters (about 60 show in Google).`;
  if (seo_description.length > MAX_SEO_DESCRIPTION) errors.seo_description = `Keep the search description under ${MAX_SEO_DESCRIPTION} characters (about 155 show in Google).`;

  if (image_url) {
    try {
      const u = new URL(image_url);
      if (u.protocol !== 'https:') errors.image_url = 'Use an https:// image URL.';
    } catch {
      errors.image_url = 'Enter a valid URL.';
    }
  }

  if (!Number.isFinite(price_cents) || price_cents < 50) errors.price = 'Enter a price of at least €0.50 (VAT included).';
  else if (price_cents > 99_999_99) errors.price = 'Price must be under €100,000.';

  if (!Number.isInteger(min_buyers) || min_buyers < 1 || min_buyers > 10_000) {
    errors.min_buyers = 'Minimum buyers must be a whole number from 1 to 10,000.';
  }

  if (!/^txcd_\d{8}$/.test(tax_code)) errors.tax_code = 'Stripe tax codes look like txcd_99999999.';

  // The browser sends deadline_iso (converted from the local datetime input); fall back to the raw value.
  const rawDeadline = String(body.deadline_iso || body.deadline || '').trim();
  const deadline = rawDeadline ? new Date(rawDeadline) : null;
  const nowMs = now.getTime();
  if (!deadline || Number.isNaN(deadline.getTime())) errors.deadline = 'Choose a deadline.';
  else if (deadline.getTime() < nowMs + MIN_LEAD_MS) errors.deadline = 'The deadline must be in the future.';
  else if (deadline.getTime() > nowMs + MAX_DEAL_DURATION_MS) errors.deadline = 'The deadline can be at most 30 days from now.';

  if (Object.keys(errors).length) return { errors, deal: null };
  return {
    errors,
    deal: {
      slug: slugify(product_name),
      product_name,
      description,
      image_url,
      category,
      headline,
      social_post,
      seo_title,
      seo_description,
      price_cents,
      tax_code,
      min_buyers,
      kind,
      deadline: iso(deadline),
      created_at: iso(now),
    },
  };
}

// Admin → Edit deal. Texts, photos and the category can always change. While a deal is open and
// nobody has joined, so can the price, minimum, tax code, kind (goods or download) and deadline. Once someone has joined,
// they agreed to that price and minimum, so those stay; the deadline can only move later.
// After a deal has closed (charging, ready to order, expired) only the texts change.
// Returns { errors, changes, locked } where changes holds the columns to update.
export function validateDealEdit(body, deal, { now, joined }) {
  const open = deal.status === 'open';
  const locked = !open || joined > 0;
  const input = {
    ...body,
    price: locked ? (deal.price_cents / 100).toFixed(2) : body.price,
    min_buyers: locked ? String(deal.min_buyers) : body.min_buyers,
    tax_code: locked ? deal.tax_code : body.tax_code,
    kind: locked ? deal.kind : body.kind || deal.kind,
    deadline_iso: open ? body.deadline_iso || body.deadline || deal.deadline : deal.deadline,
  };
  const { errors, deal: valid } = validateDealInput(input, { now, defaultTaxCode: deal.tax_code });
  // An unchanged deadline is fine even when it no longer fits the 30-day rule (or has passed on a
  // closed deal).
  const newDeadline = valid?.deadline ?? (input.deadline_iso ? new Date(input.deadline_iso) : null);
  // The form works in whole minutes, so a deadline within a minute of the saved one is unchanged.
  const sameDeadline = newDeadline && !Number.isNaN(new Date(newDeadline).getTime()) && Math.abs(new Date(newDeadline) - new Date(deal.deadline)) < 60_000;
  if (sameDeadline || !open) delete errors.deadline;
  if (open && joined > 0 && !sameDeadline && !errors.deadline && newDeadline && new Date(newDeadline) < new Date(deal.deadline)) {
    errors.deadline = 'Buyers have joined, so the deadline can only move later.';
  }
  if (Object.keys(errors).length) return { errors, changes: null, locked };
  const v = valid ?? validateDealInput({ ...input, deadline_iso: new Date(now.getTime() + 3_600_000).toISOString() }, { now, defaultTaxCode: deal.tax_code }).deal;
  const changes = {
    product_name: v.product_name,
    headline: v.headline,
    description: v.description,
    social_post: v.social_post,
    image_url: v.image_url,
    category: v.category,
    seo_title: v.seo_title,
    seo_description: v.seo_description,
  };
  if (!locked) Object.assign(changes, { price_cents: v.price_cents, min_buyers: v.min_buyers, tax_code: v.tax_code, kind: v.kind });
  if (open && !sameDeadline) changes.deadline = iso(newDeadline);
  return { errors, changes, locked };
}
