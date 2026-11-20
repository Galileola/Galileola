import { CATEGORIES, CATEGORY_SLUGS, DEFAULT_CATEGORY, isCategory } from './categories.js';
import { DescribeInputError, parseImages } from './describe.js';
import { MAX_HEADLINE, MAX_SOCIAL_POST } from './deals.js';

// "Snap a deal" (admin, phone camera): Claude looks at the product photos and writes the whole
// ad in one go: name, headline, category, deal-page text and a social media post. The admin
// adds the price, checks the text and publishes.

export const MAX_NOTES = 2000;

// Validates the JSON from the snap page. Returns { notes, images } or throws DescribeInputError.
export function validateSnapInput(body) {
  const notes = String(body?.notes ?? '').trim();
  if (notes.length > MAX_NOTES) throw new DescribeInputError(`Keep your notes under ${MAX_NOTES.toLocaleString('en')} characters.`);
  const images = parseImages(body?.images);
  if (!images.length) throw new DescribeInputError('Take a photo of the product first.');
  return { notes, images };
}

const known = (value) => value && !String(value).startsWith('[');

export function snapSystemPrompt(business) {
  const shop = known(business.name) ? business.name : 'a group-buying shop';
  const categories = CATEGORIES.map((c) => `- ${c.slug}: ${c.name} (${c.hint})`).join('\n');
  return `You write the ads for ${shop}, which sells products to customers in the European Union through group deals: buyers join a deal, and when enough people have joined, everyone gets the product at the group price. The shop owner has just photographed a product they want to offer. Your text goes onto the public deal page and into the shop's social media posts, after the owner has read it.

Work only from the photos and the owner's notes.
- Name the product as precisely as the photos allow. Use a brand or model name only if it is clearly readable on the product or its packaging, or given in the notes. If you can only tell what kind of product it is, use a plain descriptive name, such as "Stainless steel water bottle".
- Describe only what you can see or what the notes say. Don't invent specifications, sizes, capacities, materials, certifications, origin, awards, health effects, delivery times or guarantees, and don't claim the product is the best, the cheapest or the most popular. Buyers rely on this text, and misleading claims in an ad can break EU consumer law. When you aren't sure about something, leave it out.
- Don't mention the price, discounts, the deadline, VAT or stock: the deal page shows those.
- If the notes are written in a language other than English, write every field in that language. Otherwise write in English.

Tone: fun, warm and upbeat, like a friend who has found something great and wants to share it. Concrete details beat hype words.

The fields:
- product_name: at most 60 characters, no emojis.
- headline: one catchy line for the deal card, at most 70 characters, with at most one emoji.
- category: the best fit from this list (use "other" only when nothing else fits):
${categories}
- description: the text for the deal page. 2 or 3 short paragraphs, 60 to 140 words in total, separated by a blank line: open with a hook, then say what it is and why it's nice to have, based on what you can see. You may end with a short list of visible features, one per line starting with "- ". Plain text without Markdown, at most two emojis.
- social_post: a post for Instagram, Facebook or WhatsApp that invites people to join the group deal: 1 to 3 short sentences with a few fitting emojis, then 3 to 5 hashtags on a last line of their own. Don't add a link: the shop adds the deal link itself.
- photo_note: an empty string when the photos clearly show one product. Otherwise one short sentence for the shop owner, for example that the photo is blurry, or that it shows several products and which one you wrote about.`;
}

export function snapMessages({ notes, images }) {
  const content = images.map((img) => ({ type: 'image', source: { type: 'base64', ...img } }));
  content.push({
    type: 'text',
    text: `${images.length} photo(s) of the product are attached above.\n\nNotes from the shop owner:\n<notes>\n${notes || '(none)'}\n</notes>`,
  });
  return [{ role: 'user', content }];
}

export const SNAP_SCHEMA = {
  type: 'object',
  properties: {
    product_name: { type: 'string', description: 'Product name, at most 60 characters.' },
    headline: { type: 'string', description: 'One catchy line for the deal card, at most 70 characters.' },
    category: { type: 'string', enum: CATEGORY_SLUGS },
    description: { type: 'string', description: 'Deal page text, plain text, paragraphs separated by a blank line.' },
    social_post: { type: 'string', description: 'Social media post with emojis and hashtags, no link.' },
    photo_note: { type: 'string', description: 'Empty, or one sentence for the shop owner about a problem with the photos.' },
  },
  required: ['product_name', 'headline', 'category', 'description', 'social_post', 'photo_note'],
  additionalProperties: false,
};

// Tidies the model's JSON reply into form values. Returns null when there's nothing usable.
export function parseSnapReply(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const draft = {
    product_name: str(data?.product_name, 120),
    headline: str(data?.headline, MAX_HEADLINE).replace(/\s+/g, ' '),
    category: isCategory(data?.category) ? data.category : DEFAULT_CATEGORY,
    description: str(data?.description, 5000),
    social_post: str(data?.social_post, MAX_SOCIAL_POST),
    photo_note: str(data?.photo_note, 300),
  };
  return draft.product_name && draft.description ? draft : null;
}
