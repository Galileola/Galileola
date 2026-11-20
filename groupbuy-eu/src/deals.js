import { MAX_DEAL_DURATION_MS, parseEuroToCents, slugify, iso } from './util.js';
import { DEFAULT_CATEGORY, isCategory } from './categories.js';

export const MAX_HEADLINE = 120;
export const MAX_SOCIAL_POST = 2000;

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
  const tax_code = String(body.tax_code ?? '').trim() || defaultTaxCode;
  const price_cents = parseEuroToCents(body.price);
  const min_buyers = Number(body.min_buyers);

  if (!product_name) errors.product_name = 'Enter a product name.';
  else if (product_name.length > 120) errors.product_name = 'Keep the name under 120 characters.';
  if (description.length > 5000) errors.description = 'Keep the description under 5,000 characters.';
  if (headline.length > MAX_HEADLINE) errors.headline = `Keep the headline under ${MAX_HEADLINE} characters.`;
  if (social_post.length > MAX_SOCIAL_POST) errors.social_post = `Keep the social media post under ${MAX_SOCIAL_POST} characters.`;
  if (!isCategory(category)) errors.category = 'Choose a category from the list.';

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
      price_cents,
      tax_code,
      min_buyers,
      deadline: iso(deadline),
      created_at: iso(now),
    },
  };
}
