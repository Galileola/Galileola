import { formatEuro, formatDate } from './util.js';

// Plain-text email templates. Every template gets ({ deal, p, baseUrl, business, now }).
const sign = (business) => `\n\n${business.name}\n${business.address}\n${business.email}`;
const amountLine = (deal, p) =>
  `${formatEuro(p.amount_cents ?? deal.price_cents)} incl. VAT` + (p.tax_cents != null ? ` (of which VAT ${formatEuro(p.tax_cents)})` : '');
const payLink = (baseUrl, p) => `${baseUrl}/pay/${p.token}`;
const methodLine = (p) => (p.payment_method_label ? `Payment method: ${p.payment_method_label}` : '');

export const templates = {
  joined: ({ deal, p, baseUrl, business }) => ({
    subject: `You've joined: ${deal.product_name}`,
    body: `Hi ${p.name},

${deal.status === 'open' ? `You've joined the group deal for ${deal.product_name}. Nothing has been charged.

What happens next:
- If at least ${deal.min_buyers} buyers join by ${formatDate(deal.deadline)}, we charge ${amountLine(deal, p)} to your saved payment method.
- If the minimum isn't reached by then, nothing is charged and your saved payment method is removed.` : `You've joined the group deal for ${deal.product_name}. The deal has already reached its minimum, so we're collecting ${amountLine(deal, p)} now. We'll email you as soon as the payment goes through.`}

${methodLine(p)}
Deal page: ${baseUrl}/deals/${deal.slug}

You have a 14-day right of withdrawal, explained in our terms: ${baseUrl}/terms${sign(business)}`,
  }),

  // Doubles as the SEPA pre-notification (amount + collection date).
  minimumReached: ({ deal, p, business, now }) => ({
    subject: `Deal on! We're collecting payment for ${deal.product_name}`,
    body: `Hi ${p.name},

The group deal for ${deal.product_name} has reached its minimum of ${deal.min_buyers} buyers.

We are now collecting ${amountLine(deal, p)} from your saved payment method.
${methodLine(p)}
${p.payment_method_type === 'sepa_debit' ? `\nThis is your pre-notification for the SEPA Direct Debit: amount ${formatEuro(p.amount_cents ?? deal.price_cents)}, collected from today (${formatDate(now)}). It usually reaches your account within a few business days.\n` : ''}
If the payment doesn't go through, we'll email you a link to fix it. You'll have 48 hours.${sign(business)}`,
  }),

  paid: ({ deal, p, baseUrl, business }) => ({
    subject: `Payment received: ${deal.product_name}`,
    body: `Hi ${p.name},

We've received your payment of ${amountLine(deal, p)} for ${deal.product_name}.
${methodLine(p)}

Your order is confirmed. We'll let you know when it ships.
Your 14-day right of withdrawal starts when you receive the goods: ${baseUrl}/terms#withdrawal${sign(business)}`,
  }),

  processing: ({ deal, p, baseUrl, business }) => ({
    subject: `Direct debit started: ${deal.product_name}`,
    body: `Hi ${p.name},

We've started collecting ${amountLine(deal, p)} for ${deal.product_name} by SEPA Direct Debit.
It normally takes a few business days to complete. Your place in the order is confirmed.${sign(business)}`,
  }),

  paymentFailed: ({ deal, p, baseUrl, business }) => ({
    subject: `Action needed: payment for ${deal.product_name} didn't go through`,
    body: `Hi ${p.name},

We tried to collect ${amountLine(deal, p)} for ${deal.product_name}, but the payment didn't go through${p.last_error_message ? ` (${p.last_error_message})` : ''}.

Please update your payment method here before ${formatDate(p.grace_ends_at)}:
${payLink(baseUrl, p)}

We'll also retry automatically a few times. If it's still unpaid after the deadline, your order will be cancelled and you won't be charged.${sign(business)}`,
  }),

  authenticationRequired: ({ deal, p, baseUrl, business }) => ({
    subject: `Action needed: confirm your payment for ${deal.product_name}`,
    body: `Hi ${p.name},

The group deal for ${deal.product_name} reached its minimum. Your bank needs you to confirm the payment of ${amountLine(deal, p)} (Strong Customer Authentication).

Confirm it here before ${formatDate(p.grace_ends_at)}. You can also choose a different payment method:
${payLink(baseUrl, p)}

If it isn't confirmed by then, your order will be cancelled and you won't be charged.${sign(business)}`,
  }),

  reminder: ({ deal, p, baseUrl, business }) => ({
    subject: `Reminder: your payment for ${deal.product_name} is still open`,
    body: `Hi ${p.name},

Your payment of ${amountLine(deal, p)} for ${deal.product_name} still hasn't gone through.
You have until ${formatDate(p.grace_ends_at)} to complete it:
${payLink(baseUrl, p)}${sign(business)}`,
  }),

  windowClosed: ({ deal, p, baseUrl, business }) => ({
    subject: `Order cancelled: ${deal.product_name}`,
    body: `Hi ${p.name},

We couldn't collect your payment for ${deal.product_name} within 48 hours, so your order has been cancelled.
You have not been charged.${sign(business)}`,
  }),

  dealExpired: ({ deal, p, baseUrl, business }) => ({
    subject: `Deal didn't reach its minimum: ${deal.product_name}`,
    body: `Hi ${p.name},

The group deal for ${deal.product_name} didn't reach its minimum of ${deal.min_buyers} buyers by ${formatDate(deal.deadline)}.

Nobody was charged. We've removed your saved payment method.${sign(business)}`,
  }),

  withdrawn: ({ deal, p, baseUrl, business }) => ({
    subject: `Withdrawal confirmed: ${deal.product_name}`,
    body: `Hi ${p.name},

We've processed your withdrawal from ${deal.product_name}.
${p.refund_id ? `We've refunded ${formatEuro(p.amount_cents)} to your original payment method. It can take 5–10 business days to appear.` : 'You have not been charged and your saved payment method has been removed.'}${sign(business)}`,
  }),
};

export function render(kind, data) {
  const t = templates[kind];
  if (!t) throw new Error(`Unknown email template: ${kind}`);
  const { subject, body } = t(data);
  return { subject, body: body.replace(/\n{3,}/g, '\n\n') };
}
