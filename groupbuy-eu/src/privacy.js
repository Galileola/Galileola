import { randomToken } from './util.js';

// Personal data that is no longer needed is anonymised: sign-ups that were never charged (the deal
// didn't go ahead, the buyer withdrew before paying, or they never finished joining) 30 days after
// they ended, and on request from the admin's customer page. Orders that were paid stay: tax law
// and possible claims need them (see the privacy policy).

export const ERASE_AFTER_DAYS = 30;
const DAY = 24 * 3600 * 1000;

// A sign-up that never led to a payment.
export const isErasable = (p) =>
  !p.erased_at && (['released', 'pending_setup'].includes(p.status) || (p.status === 'withdrawn' && !p.paid_at && !p.refund_id));

// Removes the buyer's name, email address and delivery address (the country, language and amounts
// stay for the statistics), stops their private links from working and deletes their Stripe
// customer record. Returns true if the row was anonymised.
export async function anonymise(ctx, p) {
  const { repo, clock, stripe } = ctx;
  if (!isErasable(p)) return false;
  if (p.stripe_customer_id && stripe?.customers?.del) {
    try {
      await stripe.customers.del(p.stripe_customer_id);
    } catch (err) {
      if (err?.code !== 'resource_missing') console.warn(`[privacy] Stripe customer ${p.stripe_customer_id} not deleted: ${err.message}`);
    }
  }
  const now = clock.now().toISOString();
  repo.updateParticipant(
    p.id,
    {
      name: '',
      email: `erased-${p.id}@invalid`,
      address_line1: '',
      address_line2: '',
      postal_code: '',
      city: '',
      token: `erased-${randomToken(18)}`,
      stripe_customer_id: null,
      erased_at: now,
    },
    now
  );
  return true;
}

// Run from the scheduler: anonymises sign-ups that ended more than ERASE_AFTER_DAYS ago.
export async function anonymiseOldSignups(ctx) {
  const before = new Date(ctx.clock.now().getTime() - ERASE_AFTER_DAYS * DAY).toISOString();
  const due = ctx.repo.participantsWhere(
    `erased_at IS NULL AND updated_at <= :before AND (status IN ('released', 'pending_setup')
       OR (status = 'withdrawn' AND paid_at IS NULL AND refund_id IS NULL))`,
    { before }
  );
  let n = 0;
  for (const p of due) if (await anonymise(ctx, p)) n += 1;
  if (n) console.log(`[privacy] anonymised ${n} sign-up(s) that ended more than ${ERASE_AFTER_DAYS} days ago`);
  return n;
}
