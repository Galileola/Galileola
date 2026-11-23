import crypto from 'node:crypto';
import { isValidEmail } from './util.js';
import { isPlaceholder } from './businessSettings.js';
import { render } from './emails.js';

// The online withdrawal function (Article 11a of Directive 2011/83/EU as amended by Directive
// (EU) 2023/2673, applying since 19 June 2026): a "Withdraw from contract here" link on every page
// opens /withdraw, where the buyer gives their name, the order and an email address, and presses
// "Confirm withdrawal". They get an acknowledgement by email straight away, with what they sent
// and the date and time.
//
// What happens to the order:
//  - Opened from the buyer's own link (their order page or an email: /withdraw?order=<token>), an
//    order that hasn't been charged is cancelled at once and the saved payment method released.
//  - Paid orders, payments in progress and requests from the general link (anyone could type
//    someone else's email there) wait for the owner in Admin → Withdrawals.

// Statuses engine.withdraw() can end without money moving.
const NOT_CHARGED = ['pending_setup', 'saved', 'failed', 'unpaid', 'late_failed'];
const ENDED = ['withdrawn', 'released'];
export const LIMITS = { name: 120, email: 254, order: 300, message: 1000 };

// "W-7K3M9Q": easy to read out and type (no 0/O, 1/I).
const REF_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const newReference = () => `W-${[...crypto.randomBytes(6)].map((b) => REF_CHARS[b % REF_CHARS.length]).join('')}`;

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

// The form. `known` is true when the order came from the buyer's own link.
export function validateWithdrawal(body, t, { known = false } = {}) {
  const input = {
    name: clean(body.name, LIMITS.name).replace(/\s+/g, ' '),
    email: clean(body.email, LIMITS.email).toLowerCase(),
    order: clean(body.order, LIMITS.order).replace(/\s+/g, ' '),
    message: clean(body.message, LIMITS.message),
  };
  const errors = {};
  if (!input.name) errors.name = t('withdraw.errName');
  if (!isValidEmail(input.email)) errors.email = t('withdraw.errEmail');
  if (!known && !input.order) errors.order = t('withdraw.errOrder');
  return { input, errors };
}

// Where the shop hears about withdrawals: ADMIN_EMAIL, else the shop's contact email.
function shopAddress(config) {
  for (const candidate of [config.adminEmail, config.business?.email]) {
    const email = String(candidate ?? '').trim();
    if (!isPlaceholder(email) && isValidEmail(email)) return email;
  }
  return '';
}

// Records the withdrawal, acts on the order where it safely can, and sends the acknowledgement.
// participant: the order from the buyer's own link, or null. Returns { withdrawal, outcome }, where
// outcome is 'cancelled', 'refund', 'review' or 'ended'.
export async function submitWithdrawal(ctx, { participant = null, input, lang = 'en' }) {
  const { repo, engine, mailer, clock, config } = ctx;
  const p = participant ? repo.participantById(participant.id) : null;
  const deal = p ? repo.dealById(p.deal_id) : null;
  // Saved first, so the withdrawal is on record whatever happens next.
  const createdAt = clock.now().toISOString();
  let withdrawal = repo.insertWithdrawal({
    reference: newReference(),
    participant_id: p?.id ?? null,
    name: input.name,
    email: input.email,
    order_text: p ? `#${p.id} ${deal.product_name}` : input.order,
    message: input.message,
    lang,
    status: 'open',
    note: 'Sent from the general withdrawal link: check which order it is, then refund or cancel it.',
    created_at: createdAt,
  });

  let outcome = 'review';
  let change = null;
  if (p) {
    if (NOT_CHARGED.includes(p.status)) {
      try {
        await engine.withdraw(p.id, { notify: false });
        outcome = 'cancelled';
        change = { status: 'cancelled', note: 'Cancelled automatically: nothing had been charged, and the saved payment method was released.' };
      } catch (err) {
        change = { note: `Could not be cancelled automatically (${err.message}). Please handle it.` };
      }
    } else if (p.status === 'paid') {
      outcome = 'refund';
      change = { note: 'Paid order: refund it here once the goods are back (or right away).' };
    } else if (ENDED.includes(p.status)) {
      outcome = 'ended';
      change = { status: 'done', note: `The order had already ended (${p.status}).` };
    } else {
      change = { note: `The payment is in progress (${p.status}): wait until it has settled, then refund it.` };
    }
  }
  if (change) {
    repo.updateWithdrawal(withdrawal.id, { ...change, ...(change.status ? { handled_at: clock.now().toISOString() } : {}) });
    withdrawal = repo.withdrawalById(withdrawal.id);
  }

  // The acknowledgement, in the buyer's language, without delay.
  const data = { withdrawal, outcome, business: config.business, baseUrl: config.baseUrl, lang };
  const ack = render('withdrawalReceived', data);
  await mailer.send({ kind: 'withdrawalReceived', to: withdrawal.email, ...ack, dealId: deal?.id ?? null, participantId: p?.id ?? null });
  const to = shopAddress(config);
  if (to) {
    const notice = render('withdrawalNotice', { ...data, lang: 'en' });
    await mailer.send({ kind: 'withdrawalNotice', to, ...notice, dealId: deal?.id ?? null, participantId: p?.id ?? null });
  }
  return { withdrawal, outcome };
}

// Admin → Withdrawals: refund a paid order (engine.withdraw refunds in full and reverses the VAT
// record), or mark the request as handled.
export async function refundWithdrawal(ctx, withdrawal) {
  const { repo, engine, clock } = ctx;
  if (!withdrawal.participant_id) throw new Error('This withdrawal is not linked to an order. Refund it from the deal page.');
  const p = await engine.withdraw(withdrawal.participant_id);
  repo.updateWithdrawal(withdrawal.id, {
    status: 'done',
    note: p.refund_id ? `Refunded (${p.refund_id}).` : 'Cancelled: nothing had been charged.',
    handled_at: clock.now().toISOString(),
  });
  return p;
}
