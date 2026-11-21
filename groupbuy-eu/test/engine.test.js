import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, createRepo } from '../src/db.js';
import { createEngine, JoinError } from '../src/engine.js';
import { createMailer } from '../src/mailer.js';
import { createFakeStripe } from './support/fakeStripe.js';

// The payment scenarios of docs/TEST_CHECKLIST.md, run against an in-memory Stripe with a clock
// the test moves forward.
const HOUR = 3600_000;

function setup({ minBuyers = 3, deadlineHours = 48 } = {}) {
  let nowMs = Date.parse('2027-03-01T10:00:00Z');
  const clock = { now: () => new Date(nowMs) };
  const repo = createRepo(openDb(':memory:'));
  const stripe = createFakeStripe({ clock });
  const config = { baseUrl: 'https://shop.test', quietEmails: true, business: { name: 'Shop', address: 'A', email: 'a@b.ee' } };
  const ctx = { config, repo, clock, stripe };
  ctx.mailer = createMailer(ctx);
  const engine = createEngine(ctx);
  const deal = repo.insertDeal({
    slug: 'lamp-1', product_name: 'Oak lamp', description: '', image_url: '', price_cents: 4900, tax_code: 'txcd_99999999',
    min_buyers: minBuyers, deadline: new Date(nowMs + deadlineHours * HOUR).toISOString(), created_at: new Date(nowMs).toISOString(),
  });
  const join = async (email, country, behaviour = 'card_ok') => {
    const p = await engine.startJoin(repo.dealById(deal.id), {
      email, name: email.split('@')[0], address_line1: 'Street 1', address_line2: '', postal_code: '10115', city: 'City', country, lang: 'en',
    });
    stripe._completeSetup(p.setup_intent_id, behaviour);
    await engine.finalizeSetupIntent(p.setup_intent_id);
    await engine.idle();
    return repo.participantById(p.id);
  };
  const p = (x) => repo.participantById(x.id);
  const mails = (x) => repo.emailsFor(x.id).map((e) => e.kind);
  const advance = async (ms, { tick = true } = {}) => {
    nowMs += ms;
    if (!tick) return;
    await engine.tick();
    await engine.idle();
  };
  return { repo, stripe, engine, deal, join, p, mails, advance, dealNow: () => repo.dealById(deal.id), clock };
}

test('deal fills: card paid at once, SEPA and iDEAL processing then paid, VAT per country, late joiner, ready to order', async () => {
  const s = setup();
  const a = await s.join('anna@example.com', 'DE', 'card_ok');
  assert.equal(a.status, 'saved');
  assert.equal(a.amount_cents, 4900, 'the gross price is the same for everyone');
  assert.equal(a.tax_cents, 782, '19% German VAT inside €49.00');
  assert.equal(a.tax_rate_label, '19% VAT DE');
  assert.equal(a.payment_method_label, 'Visa •••• 4242');
  assert.deepEqual(s.mails(a), ['joined']);
  assert.equal(s.stripe._store.paymentIntents.size, 0, 'nobody is charged while the deal is open');

  const b = await s.join('ben@example.com', 'AT', 'sepa_ok');
  assert.equal(b.tax_cents, 817, '20% Austrian VAT');
  assert.match(b.payment_method_label, /^SEPA Direct Debit \(DE\) •••• 3000$/);
  assert.equal(s.dealNow().status, 'open');

  const c = await s.join('cleo@example.com', 'NL', 'ideal');
  assert.match(s.p(c).payment_method_label, /SEPA Direct Debit via iDEAL \(ing\) •••• 5264/);
  assert.ok(s.p(c).mandate_id, 'iDEAL leaves a SEPA mandate');
  // The third buyer completes the minimum: everyone is charged.
  assert.equal(s.dealNow().status, 'charging');
  assert.equal(s.p(a).status, 'paid');
  assert.equal(s.p(b).status, 'processing');
  assert.equal(s.p(c).status, 'processing');
  assert.ok(s.p(a).tax_transaction_id, 'VAT recorded once money is collected');
  assert.equal(s.p(b).tax_transaction_id, null, '…and not for debits still processing');
  assert.equal(s.stripe._store.paymentMethods.get(s.p(a).payment_method_id).customer, null, 'paid: the card is removed');
  assert.deepEqual(s.mails(a), ['joined', 'minimumReached', 'paid']);
  assert.deepEqual(s.mails(b), ['joined', 'minimumReached', 'processing']);
  assert.match(s.repo.emailsFor(b.id)[1].body, /SEPA|debit/i, 'the pre-notification for SEPA buyers');

  // SEPA settles (webhook).
  for (const x of [b, c]) {
    const pi = s.stripe._settle(s.p(x).payment_intent_id, true);
    await s.engine.handleEvent(s.stripe._event('payment_intent.succeeded', pi));
    assert.equal(s.p(x).status, 'paid');
  }

  // A late joiner is charged at once and gets their own 48-hour window.
  await s.advance(HOUR);
  const d = await s.join('dan@example.com', 'EE', 'card_ok');
  assert.equal(d.status, 'paid');
  assert.equal(d.tax_cents, 884, '22% Estonian VAT');

  // 48 hours after the minimum: ready to order.
  await s.advance(48 * HOUR);
  assert.equal(s.dealNow().status, 'ready_to_order');
  // Exactly one payment per buyer.
  const charged = [...s.stripe._store.paymentIntents.values()].map((pi) => pi.metadata.participant_id).sort();
  assert.deepEqual(charged, [a, b, c, d].map((x) => String(x.id)).sort());
});

test('deal fails: the deadline passes below the minimum, nobody is charged, methods are removed', async () => {
  const s = setup({ deadlineHours: 2 });
  const a = await s.join('anna@example.com', 'DE', 'card_ok');
  const b = await s.join('ben@example.com', 'AT', 'sepa_ok');
  // Someone who started but never finished joining.
  const half = await s.engine.startJoin(s.dealNow(), { email: 'half@example.com', name: 'Half', address_line1: 'S', address_line2: '', postal_code: '10115', city: 'C', country: 'DE', lang: 'en' });
  await s.advance(3 * HOUR);
  assert.equal(s.dealNow().status, 'expired');
  for (const x of [a, b]) {
    assert.equal(s.p(x).status, 'released');
    assert.equal(s.stripe._store.paymentMethods.get(x.payment_method_id).customer, null);
    assert.deepEqual(s.mails(x), ['joined', 'dealExpired']);
  }
  assert.equal(s.p(half).status, 'released');
  assert.equal(s.stripe._store.setupIntents.get(half.setup_intent_id).status, 'canceled');
  assert.equal(s.stripe._store.paymentIntents.size, 0);
  // Joining a closed deal is refused.
  await assert.rejects(s.join('late@example.com', 'DE'), (e) => e instanceof JoinError && e.code === 'closed');
});

test('a declined card is retried at +6h, +24h and +44h, then the order is cancelled at 48h', async () => {
  const s = setup({ minBuyers: 2 });
  const ok = await s.join('ok@example.com', 'DE', 'card_ok');
  const bad = await s.join('bad@example.com', 'DE', 'card_declined');
  assert.equal(s.p(ok).status, 'paid');
  let b = s.p(bad);
  assert.equal(b.status, 'failed');
  assert.equal(b.attempts, 1);
  assert.equal(b.last_error_code, 'insufficient_funds');
  assert.ok(b.next_retry_at);
  assert.deepEqual(s.mails(b), ['joined', 'minimumReached', 'paymentFailed']);
  for (const [hours, attempts] of [[6, 2], [18, 3], [20, 4]]) {
    await s.advance(hours * HOUR);
    b = s.p(bad);
    assert.equal(b.attempts, attempts, `retried after ${hours} more hours`);
    assert.equal(b.status, 'failed');
  }
  assert.equal(b.next_retry_at, null, 'no retries left inside the window');
  assert.equal(s.mails(b).filter((k) => k === 'paymentFailed').length, 1, 'one failure email, not one per retry');
  // The 24-hour reminder went out before the window closed.
  assert.ok(s.mails(b).includes('reminder'));
  await s.advance(5 * HOUR);
  b = s.p(bad);
  assert.equal(b.status, 'unpaid');
  assert.equal(s.stripe._store.paymentIntents.get(b.payment_intent_id).status, 'canceled');
  assert.ok(s.mails(b).includes('windowClosed'));
  assert.equal(s.dealNow().status, 'ready_to_order');
  // One PaymentIntent for this buyer across all four attempts.
  assert.equal([...s.stripe._store.paymentIntents.values()].filter((pi) => pi.metadata.participant_id === String(bad.id)).length, 1);
});

test('3-D Secure: no blind retries; the buyer pays on the update page; hard declines are not retried', async () => {
  const s = setup({ minBuyers: 3 });
  await s.join('ok@example.com', 'DE', 'card_ok');
  const sca = await s.join('sca@example.com', 'DE', 'card_sca');
  const stolen = await s.join('stolen@example.com', 'DE', 'card_hard');
  let x = s.p(sca);
  assert.equal(x.status, 'failed');
  assert.equal(x.needs_authentication, 1);
  assert.equal(x.next_retry_at, null);
  assert.deepEqual(s.mails(x), ['joined', 'minimumReached', 'authenticationRequired']);
  assert.equal(s.p(stolen).next_retry_at, null, 'stolen card: wait for the buyer');
  // The buyer opens the link and confirms with 3-D Secure.
  const pi = s.stripe._payOnSession(x.payment_intent_id);
  await s.engine.applyPaymentIntent(pi);
  x = s.p(sca);
  assert.equal(x.status, 'paid');
  assert.equal(x.needs_authentication, 0);
  // The stolen-card buyer pays with a new card instead.
  const pi2 = s.stripe._payOnSession(s.p(stolen).payment_intent_id, 'card_ok');
  await s.engine.applyPaymentIntent(pi2);
  assert.equal(s.p(stolen).status, 'paid');
  assert.equal(s.p(stolen).payment_method_label, 'Mastercard •••• 4444', 'the method actually used is recorded');
});

test('a SEPA debit that bounces inside the window can be fixed; after the window it is flagged', async () => {
  const s = setup({ minBuyers: 2 });
  const early = await s.join('early@example.com', 'DE', 'sepa_fail');
  const late = await s.join('late@example.com', 'DE', 'sepa_fail');
  assert.equal(s.p(early).status, 'processing');
  // Bounces after 2 days: still inside the window → failed, with the update link.
  await s.advance(24 * HOUR);
  await s.engine.handleEvent(s.stripe._event('payment_intent.payment_failed', s.stripe._settle(s.p(early).payment_intent_id, false)));
  assert.equal(s.p(early).status, 'failed');
  assert.ok(s.mails(early).includes('paymentFailed'));
  // The other bounces after the window: the order already counted it → late_failed (your cost).
  await s.advance(30 * HOUR);
  await s.engine.handleEvent(s.stripe._event('payment_intent.payment_failed', s.stripe._settle(s.p(late).payment_intent_id, false)));
  assert.equal(s.p(late).status, 'late_failed');
});

test('withdrawal: a paid buyer is refunded with a VAT reversal; a saved buyer is released', async () => {
  const s = setup({ minBuyers: 1 });
  const paid = await s.join('paid@example.com', 'DE', 'card_ok');
  assert.equal(s.p(paid).status, 'paid');
  const w = await s.engine.withdraw(paid.id);
  assert.equal(w.status, 'withdrawn');
  assert.ok(w.refund_id);
  assert.equal(s.stripe._store.refunds.get(w.refund_id).amount, 4900);
  assert.equal(s.stripe._store.reversals.size, 1);
  assert.ok(s.mails(paid).includes('withdrawn'));

  const s2 = setup({ minBuyers: 5 });
  const saved = await s2.join('saved@example.com', 'DE', 'card_ok');
  const w2 = await s2.engine.withdraw(saved.id);
  assert.equal(w2.status, 'withdrawn');
  assert.equal(w2.refund_id, null);
  assert.equal(s2.stripe._store.paymentMethods.get(saved.payment_method_id).customer, null);
  await assert.rejects(s2.engine.withdraw(saved.id), /Nothing to withdraw/);
});

test('safety: no double charges, outages are retried later, duplicate and other-mode events are ignored', async () => {
  const s = setup({ minBuyers: 2 });
  const a = await s.join('a@example.com', 'DE', 'card_ok');
  // Stripe is down when the minimum is reached: the buyer goes back to "saved" and is retried.
  s.stripe._failNext('paymentIntents.create');
  const b = await s.join('b@example.com', 'DE', 'card_ok');
  const results = [s.p(a).status, s.p(b).status].sort();
  assert.deepEqual(results, ['paid', 'saved']);
  const waiting = s.p(a).status === 'saved' ? a : b;
  assert.match(s.p(waiting).last_error_message, /^system:/);
  await s.advance(11 * 60_000);
  assert.equal(s.p(waiting).status, 'paid');

  // Charging the same buyer again, or two at once, never makes a second payment.
  await Promise.all([s.engine.chargeParticipant(a.id), s.engine.chargeParticipant(a.id), s.engine.chargeAllSaved(s.deal.id)]);
  assert.equal(s.stripe._store.paymentIntents.size, 2);

  // The same setup finishing twice (return page and webhook) counts once.
  const s2 = setup({ minBuyers: 5 });
  const x = await s2.join('x@example.com', 'DE', 'card_ok');
  await s2.engine.finalizeSetupIntent(x.setup_intent_id);
  assert.deepEqual(s2.mails(x), ['joined']);
  // A live-mode object in test mode is refused.
  const pi = { ...s.stripe._store.paymentIntents.values().next().value, livemode: true };
  await assert.rejects(s.engine.applyPaymentIntent(pi), /live-mode PaymentIntent in test mode/);
  // Joining twice with the same email is refused.
  await assert.rejects(s2.join('x@example.com', 'DE'), (e) => e.code === 'already_joined');
});

test('a buyer whose setup finishes after the deadline (before the scheduler ran) is released, not charged', async () => {
  const s = setup({ deadlineHours: 1 });
  const p = await s.engine.startJoin(s.dealNow(), { email: 'slow@example.com', name: 'Slow', address_line1: 'S', address_line2: '', postal_code: '10115', city: 'C', country: 'DE', lang: 'en' });
  await s.advance(2 * HOUR, { tick: false });
  s.stripe._completeSetup(p.setup_intent_id, 'card_ok');
  const { tooLate } = await s.engine.finalizeSetupIntent(p.setup_intent_id);
  assert.equal(tooLate, true);
  assert.equal(s.p(p).status, 'released');
  assert.equal(s.stripe._store.paymentMethods.get(s.p(p).payment_method_id).customer, null, 'the method is removed');
});
