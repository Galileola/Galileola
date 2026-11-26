import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { STYLES, STYLE_IDS } from './styles.js';

// Claude is the art director: it studies the photo, writes the ad, briefs
// the image AI and checks every scene before it reaches the client.
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

let client;
function claude() {
  client ??= new Anthropic();
  return client;
}

export function claudeConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const LANGUAGES = { en: 'English', ru: 'Russian', et: 'Estonian' };

const Brief = z.object({
  usable: z.boolean().describe('false if the photo has no clear product to advertise'),
  problem: z.string().describe('if not usable: a short, friendly explanation for the user, in the ad language; otherwise empty'),
  product: z.object({
    name: z.string().describe('what the product is, e.g. "LUMEA vitamin C serum"'),
    look: z.string().describe('what it looks like: shape, material, colours, label, cap; precise enough to check a picture against it'),
    cutout: z.string().describe('instruction for the cut-out tool naming only the product, e.g. "only the amber glass dropper bottle"'),
  }),
  style: z.enum(STYLE_IDS),
  copy: z.object({
    headline: z.string(),
    subline: z.string(),
    cta: z.string(),
    badge: z.string().describe('short offer sticker such as "-30%" or "NEW", or empty when the brief gives no concrete offer'),
  }),
  palette: z.object({
    primary: z.string().describe('#rrggbb'),
    accent: z.string().describe('#rrggbb, used for the button and the badge'),
  }),
  scene: z.object({
    setting: z.string().describe('English. Surface the product stands on, background, at most three props; photorealistic and true to the product size'),
    lighting: z.string().describe('English. Light direction, quality and colour, camera feel'),
  }),
  video: z.object({
    motion: z.string().describe('English. 5-second camera move and atmosphere; the product itself stays still and unchanged'),
  }),
});

const Review = z.object({
  score: z.number().describe('1-10: how ready this is for a paid ad'),
  product_matches: z.boolean().describe('the product looks like the one in the reference photo: shape, colours, label text'),
  single_product: z.boolean().describe('exactly one product in the scene: no copies or extra products'),
  issues: z.array(z.string()),
  fix: z.string().describe('English instructions for the image AI to fix the issues on a second try; empty if none'),
});

const BRIEF_SYSTEM = `You are the senior art director of a top advertising agency. A client has sent a phone photo of their product. You plan a professional ad campaign image around it.

Your brief goes to three places:
1. Copy that is typeset on the banner by a designer.
2. A scene description for an image AI that keeps the client's real product and replaces everything around it with a photorealistic studio or lifestyle setting.
3. A short camera move for a 5-second video made from that scene.

Copy rules:
- Write the copy in the requested language with perfect grammar, spelling and diacritics.
- Headline: 2-5 words, at most 32 characters, specific to this product, no clichés like "the best".
- Subline: one short line, at most 60 characters, a concrete benefit or detail.
- Button text: 1-3 words, at most 18 characters.
- Badge: only when the client gave a concrete offer (discount, "new", free delivery). Keep it to at most 10 characters. Otherwise leave it empty.
- Only claim what the photo shows or the client said. Never invent prices, discounts, awards, ingredients or medical effects.

Scene rules:
- Real-world scale: a small bottle stands on a vanity or pedestal, a sofa sits in a living room.
- One surface, a background, at most three props that fit the product's world. No people, no other products, nothing with text or logos.
- Match the chosen style's mood. Choose colours that make the product stand out.
- Write the scene and lighting in English.

If the photo has no clear product (for example a blank image, a selfie or a landscape), set usable to false and explain why in one friendly sentence in the requested language.`;

const STYLE_LINES = Object.entries(STYLES).map(([id, s]) => `- ${id}: ${s.mood}`).join('\n');

function imageBlock(buffer, mime) {
  return { type: 'image', source: { type: 'base64', media_type: mime, data: buffer.toString('base64') } };
}

async function ask({ system, content, schema, effort }) {
  const response = await claude().beta.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { format: zodOutputFormat(schema), effort },
    system,
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') {
    const err = new Error('The art director declined this request.');
    err.userMessage = 'This product or request can’t be advertised with this tool.';
    throw err;
  }
  if (!response.parsed_output) throw new Error(`Art director returned no brief (stop reason: ${response.stop_reason})`);
  return response.parsed_output;
}

/** Studies the photo and writes the whole campaign brief. */
export async function writeBrief({ photo, mime, request }) {
  const lines = [
    `Ad language: ${LANGUAGES[request.language]}.`,
    `Brand: ${request.brand || '(not given)'}.`,
    `Offer: ${request.offer || '(none)'}.`,
    `Details from the client: ${request.details || '(none)'}.`,
    request.style === 'auto'
      ? `Style: choose the one that suits the product and brand best:\n${STYLE_LINES}`
      : `Style: ${request.style} (${STYLES[request.style].mood}). Use this style.`,
  ];
  const brief = await ask({
    system: BRIEF_SYSTEM,
    content: [imageBlock(photo, mime), { type: 'text', text: lines.join('\n') }],
    schema: Brief,
    effort: 'medium',
  });
  if (request.style !== 'auto') brief.style = request.style;
  return brief;
}

/** Checks one finished scene (before text) against the original photo. */
export async function reviewScene({ photo, mime, scene, brief, textArea }) {
  const result = await ask({
    system: 'You are the creative director who approves ad images before they go to a paying client. Be strict but fair.',
    content: [
      { type: 'text', text: 'Reference: the client’s original product photo.' },
      imageBlock(photo, mime),
      { type: 'text', text: 'Candidate ad scene (text is added later).' },
      imageBlock(scene, 'image/png'),
      {
        type: 'text',
        text: `The product: ${brief.product.name}. ${brief.product.look}
The planned scene: ${brief.scene.setting}. ${brief.scene.lighting}
A headline will be placed over ${textArea}; that area should be calm and must not cover the product.
Check: Does the product match the reference (shape, colours, label text)? Is there exactly one product? Does it sit naturally in the scene (scale, perspective, contact shadow)? Any AI artefacts, garbled text or odd objects? Would a premium brand run this?`,
      },
    ],
    schema: Review,
    effort: 'low',
  });
  result.pass = result.score >= 7 && result.product_matches && result.single_product;
  return result;
}
