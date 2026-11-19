import { detectImageType } from './photos.js';

// "Write with AI" on the admin's New deal form: drafts a product description from the product
// name, the admin's notes and up to MAX_IMAGES photos (downscaled in the browser first).
// The admin reviews and edits the draft before creating the deal.

export const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MEDIA_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

export class DescribeInputError extends Error {}

// Validates the JSON from the form. Returns { productName, notes, images } or throws.
export function validateDescribeInput(body) {
  const productName = String(body?.product_name ?? '').trim();
  const notes = String(body?.notes ?? '').trim();
  if (!productName) throw new DescribeInputError('Enter the product name first.');
  if (productName.length > 120) throw new DescribeInputError('Keep the product name under 120 characters.');
  if (notes.length > 5000) throw new DescribeInputError('Keep your notes under 5,000 characters.');

  const raw = Array.isArray(body?.images) ? body.images : [];
  if (raw.length > MAX_IMAGES) throw new DescribeInputError(`Use at most ${MAX_IMAGES} photos.`);
  const images = raw.map((img) => {
    const data = typeof img?.data === 'string' ? img.data : '';
    const buf = Buffer.from(data, 'base64');
    const type = detectImageType(buf);
    if (!type || buf.length > MAX_IMAGE_BYTES) throw new DescribeInputError('One of the photos could not be read.');
    return { media_type: MEDIA_TYPES[type], data: buf.toString('base64') };
  });
  return { productName, notes, images };
}

const known = (value) => value && !String(value).startsWith('[');

export function describeSystemPrompt(business) {
  const shop = known(business.name) ? business.name : 'a group-buying shop';
  return `You write product descriptions for ${shop}, which sells products to customers in the European Union through group deals. Buyers read the description on the deal page before deciding to join, so it must be accurate.

Write from what the shop owner gives you: the product name, their notes and any photos.
- Use only facts that are in the name or the notes, or clearly visible in the photos. Don't invent specifications, sizes, materials, certifications, origin, brand claims, delivery times or guarantees: a wrong claim in a shop's product description can mislead buyers. When the notes don't cover something, leave it out.
- If the notes are written in a language other than English, write in that language. Otherwise write in English.
- Write 2 or 3 short paragraphs, about 60 to 150 words in total, separated by a blank line. If the notes list concrete facts (contents, dimensions, care), you may end with those as a short list, one per line starting with "- ".
- Friendly, clear and concrete. No hype words, no exclamation marks, no emojis.
- Don't mention the price, the deadline, VAT or how group buying works: the deal page already shows those.
- Plain text only: no Markdown, headings or bold.`;
}

export function describeMessages({ productName, notes, images }) {
  const content = images.map((img) => ({ type: 'image', source: { type: 'base64', ...img } }));
  content.push({
    type: 'text',
    text: `Product name: ${productName}\n\nNotes from the shop owner:\n<notes>\n${notes || '(none)'}\n</notes>\n\n${
      images.length ? `${images.length} product photo(s) are attached above.` : 'No photos are attached.'
    }`,
  });
  return [{ role: 'user', content }];
}

export const DESCRIPTION_SCHEMA = {
  type: 'object',
  properties: { description: { type: 'string', description: 'The product description, plain text, paragraphs separated by a blank line.' } },
  required: ['description'],
  additionalProperties: false,
};
