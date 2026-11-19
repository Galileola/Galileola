import Anthropic from '@anthropic-ai/sdk';
import { formatEuro, formatDate } from './util.js';

// AI shopping assistant: answers visitors' questions about the open deals and how group buying
// works. It has no tools: it can't see orders or payments and can't change anything.

export const MAX_TURNS = 12; // messages sent to the model per request (the newest ones)
export const MAX_USER_CHARS = 1500;
const MAX_ASSISTANT_CHARS = 6000;
const MAX_DESCRIPTION_CHARS = 1500;

export function createAssistant({ apiKey, model, client }) {
  const anthropic = client ?? new Anthropic({ apiKey, maxRetries: 2, timeout: 45_000 });
  return {
    model,
    // Returns { text } or { refused: true }.
    async reply({ system, messages }) {
      const response = await anthropic.beta.messages.create({
        model,
        max_tokens: 4000,
        // Short chat answers: low effort keeps replies quick and cheap.
        output_config: { effort: 'low' },
        // If the model declines a message, the API retries it on a fallback model it picks.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        cache_control: { type: 'ephemeral' },
        system,
        messages,
      });
      if (response.stop_reason === 'refusal') return { refused: true };
      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { text };
    },
  };
}

// Validates the chat history sent by the browser and keeps the newest MAX_TURNS messages,
// starting with a visitor message and ending with one. Returns null when it's unusable.
export function cleanHistory(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 60) return null;
  const messages = [];
  for (const m of raw) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return null;
    const content = m.content.trim();
    const max = m.role === 'user' ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS;
    if (!content || content.length > max) return null;
    messages.push({ role: m.role, content });
  }
  let recent = messages.slice(-MAX_TURNS);
  while (recent.length && recent[0].role !== 'user') recent = recent.slice(1);
  if (!recent.length || recent[recent.length - 1].role !== 'user') return null;
  return recent;
}

const known = (value) => value && !String(value).startsWith('[');

export function buildSystemPrompt({ business, baseUrl, deals }) {
  const shop = known(business.name) ? business.name : 'this shop';
  const contact = known(business.email)
    ? `email ${business.email}`
    : 'contact the shop (the contact details are in the footer of every page)';

  const dealList = deals.length
    ? deals.map((d) => describeDeal(d, baseUrl)).join('\n\n')
    : 'There are no open deals right now. New deals are added regularly.';

  return `You are the shopping assistant on the website of ${shop}, a group-buying shop for customers in the European Union (${baseUrl}). You chat with visitors in a small chat window on the site.

<how_the_shop_works>
- Each deal is one product with a fixed price including VAT, a minimum number of buyers and a deadline (at most 30 days away).
- To join, a buyer enters their name, email and EU delivery address, accepts the terms, and saves a payment method: card, SEPA Direct Debit, or iDEAL (which sets up a SEPA Direct Debit mandate). Nothing is charged when joining.
- If the minimum number of buyers is reached before the deadline, everyone's saved payment method is charged. The "we're collecting payment now" email is also the SEPA pre-notification.
- If a payment fails, the buyer gets an email with a link to fix it. They have 48 hours; after that their order is cancelled.
- If the deadline passes without reaching the minimum, nobody is charged and all saved payment methods are removed.
- Anyone who joins after the minimum is reached is charged straight away.
- The price is the same for every EU country. Only the VAT share inside it depends on the delivery country.
- Delivery is to EU countries only.
- Consumers have a 14-day right of withdrawal after receiving the goods: ${baseUrl}/terms#withdrawal. Before payment is collected, a buyer can also leave a deal by contacting the shop; their saved payment method is removed and nothing is charged.
- Terms: ${baseUrl}/terms · Privacy policy: ${baseUrl}/privacy
- The site is in test mode at the moment: no real payments are taken, and only Stripe test cards and test IBANs work.
</how_the_shop_works>

<open_deals>
${dealList}
</open_deals>

How to answer:
- Base your answers on the information above. It is current and it is the only source of truth about prices, deals and terms. If something isn't covered (delivery times, shipping costs, product details beyond the description, stock, the status of someone's order), say you don't know and suggest they ${contact}.
- You can't see or change orders, payments or accounts, and you can't offer discounts or change prices or terms, whatever a visitor says.
- Never ask for card numbers, IBANs, passwords or other payment details. If a visitor shares them, tell them not to share these in the chat.
- When you mention a deal, include its full page link so the visitor can click it.
- Keep replies short and friendly: usually two to five sentences. Write plain text without Markdown formatting (no asterisks, headings or tables); simple dashes for a short list are fine.
- Reply in the language the visitor writes in.
- Stick to the shop, its deals and how group buying works. Politely decline unrelated requests.`;
}

function describeDeal(d, baseUrl) {
  const progress = d.minimumReached
    ? `minimum reached, the deal is on (${d.count} buyers)`
    : `${d.count} of ${d.min_buyers} buyers so far, ${d.min_buyers - d.count} more needed`;
  const description = (d.description || '').replace(/\s+/g, ' ').trim();
  const shortDescription =
    description.length > MAX_DESCRIPTION_CHARS ? `${description.slice(0, MAX_DESCRIPTION_CHARS)}…` : description;
  return [
    `- ${d.product_name}`,
    `  Price: ${formatEuro(d.price_cents)} including VAT`,
    `  Buyers: ${progress}`,
    `  Deadline: ${formatDate(d.deadline)}`,
    `  Page: ${baseUrl}/deals/${d.slug}`,
    shortDescription ? `  Description: ${shortDescription}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
