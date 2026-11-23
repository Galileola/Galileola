import { render } from './emails.js';
import { anonymiseOldSignups } from './privacy.js';
import { isJoinable } from './dealState.js';
import { randomToken, addMs, iso, HOUR, GRACE_WINDOW_MS } from './util.js';
import { calculateVat, createSetupIntentFactory, extractSavedMethod, stripeErrorInfo, describePaymentMethod } from './stripeHelpers.js';

const MINUTE = 60_000;
// Automatic retries for declined cards, measured from the first attempt (all inside the 48h window).
export const RETRY_OFFSETS_MS = [6 * HOUR, 24 * HOUR, 44 * HOUR];
// Declines where retrying the same card can't work (and card networks penalise retries).
const HARD_DECLINES = new Set([
  'lost_card', 'stolen_card', 'pickup_card', 'fraudulent', 'restricted_card', 'expired_card',
  'incorrect_number', 'invalid_number', 'invalid_account', 'revocation_of_authorization',
  'revocation_of_all_authorizations', 'stop_payment_order', 'new_account_information_available',
]);
const CHARGEABLE_DEAL = ['charging', 'ready_to_order'];
// A scheduler run that takes longer than this (or a process that dies mid-run) loses the lock.
const TICK_LEASE_MS = 10 * MINUTE;

// code: 'closed' | 'already_joined' | 'vat', so the page can show the message in the buyer's language.
export class JoinError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// The deal/payment state machine. Every state change is an atomic "transition" in SQLite
// (UPDATE … WHERE status IN (…)), so a webhook, the scheduler and a buyer's browser can race
// without double-processing. Stripe calls that create money movements use idempotency keys.
export function createEngine(ctx) {
  const { config, repo, stripe, mailer, clock } = ctx;
  const setupIntents = createSetupIntentFactory(stripe, { initialTypes: config.paymentMethodTypes });
  const now = () => clock.now();
  const nowIso = () => clock.now().toISOString();
  let ticking = null;
  let lastPrivacyRun = 0;
  const liveMode = config.paymentsMode === 'live';
  const background = new Set();
  const instanceId = `${process.pid}-${randomToken(6)}`;

  // Work that shouldn't block a buyer's request (charging a whole deal). engine.idle() waits for it.
  function runInBackground(label, fn) {
    const pr = Promise.resolve()
      .then(fn)
      .catch((err) => console.error(`[${label}]`, err))
      .finally(() => background.delete(pr));
    background.add(pr);
  }

  async function email(kind, deal, p) {
    // The deal's name in the buyer's language, when it has been translated.
    const shown = ctx.translator ? ctx.translator.deal(deal, p.lang) : deal;
    const { subject, body } = render(kind, { deal: shown, p, baseUrl: config.baseUrl, business: config.business, now: now() });
    await mailer.send({ kind, to: p.email, subject, body, dealId: deal.id, participantId: p.id });
  }

  // Best effort: remove a saved method from the Stripe Customer once it can't be needed again.
  async function releaseMethod(p) {
    try {
      await safeDetach(p.payment_method_id);
    } catch (err) {
      console.warn(`[release] could not detach ${p.payment_method_id}:`, err.message);
    }
  }

  async function safeDetach(paymentMethodId) {
    if (!paymentMethodId) return;
    try {
      await stripe.paymentMethods.detach(paymentMethodId);
    } catch (err) {
      // Already detached / deleted is fine: the goal is that it can't be charged.
      if (err?.code !== 'resource_missing' && !/not attached|already been detached/i.test(err?.message ?? '')) throw err;
    }
  }

  const engine = {
    setupIntents,
    email,
    safeDetach,

    // ------------------------------------------------------------------ joining
    // Step 1 of joining: store the buyer, create the Stripe Customer, calculate VAT for their
    // delivery country and create an off-session SetupIntent. Nothing is charged.
    async startJoin(deal, input) {
      if (!isJoinable(deal, now())) throw new JoinError('This deal is no longer open.', 'closed');
      const n = nowIso();
      let p = repo.participantByEmail(deal.id, input.email);
      if (p && p.status !== 'pending_setup') {
        throw new JoinError('This email address has already joined this deal.', 'already_joined');
      }
      const fields = {
        name: input.name,
        address_line1: input.address_line1,
        address_line2: input.address_line2,
        postal_code: input.postal_code,
        city: input.city,
        country: input.country,
        lang: input.lang || 'en',
        terms_accepted_at: n,
      };
      if (p) {
        repo.updateParticipant(p.id, fields, n);
      } else {
        p = repo.insertParticipant({ ...fields, deal_id: deal.id, email: input.email, token: randomToken(), created_at: n });
      }
      p = repo.participantById(p.id);

      const address = {
        line1: p.address_line1,
        line2: p.address_line2 || undefined,
        postal_code: p.postal_code,
        city: p.city,
        country: p.country,
      };
      let customerId = p.stripe_customer_id;
      if (!customerId) {
        const customer = await stripe.customers.create(
          {
            email: p.email,
            name: p.name,
            address,
            shipping: { name: p.name, address },
            metadata: { participant_id: String(p.id), deal_id: String(deal.id) },
          },
          { idempotencyKey: `customer-${p.id}` }
        );
        customerId = customer.id;
      } else {
        await stripe.customers.update(customerId, { name: p.name, address, shipping: { name: p.name, address } });
      }
      repo.updateParticipant(p.id, { stripe_customer_id: customerId }, n);

      let vat;
      try {
        vat = await calculateVat(stripe, deal, p);
      } catch (err) {
        if (err?.type === 'StripeInvalidRequestError') {
          throw new JoinError('We could not calculate VAT for this address. Please check the postcode, city and country.', 'vat');
        }
        throw err;
      }
      repo.updateParticipant(p.id, vat, n);

      // Reuse an unfinished SetupIntent if the buyer comes back.
      let setupIntentId = p.setup_intent_id;
      if (setupIntentId) {
        const existing = await stripe.setupIntents.retrieve(setupIntentId);
        if (existing.status === 'canceled') setupIntentId = null;
      }
      if (!setupIntentId) {
        const si = await setupIntents.create(
          {
            customer: customerId,
            usage: 'off_session',
            description: `Group deal: ${deal.product_name}`,
            metadata: { participant_id: String(p.id), deal_id: String(deal.id) },
          },
          `setup-${p.id}-${Date.parse(n)}`
        );
        setupIntentId = si.id;
        repo.updateParticipant(p.id, { setup_intent_id: si.id }, n);
      }
      return repo.participantById(p.id);
    },

    // Step 2 of joining (from the return_url or the setup_intent.succeeded webhook):
    // record the saved payment method. Safe to call more than once.
    async finalizeSetupIntent(setupIntentId) {
      const si = await stripe.setupIntents.retrieve(setupIntentId, { expand: ['payment_method', 'latest_attempt'] });
      if (Boolean(si.livemode) !== liveMode) throw new Error(`Refusing to process a ${si.livemode ? 'live' : 'test'}-mode SetupIntent in ${liveMode ? 'live' : 'test'} mode.`);
      let p = repo.participantBySetupIntent(si.id);
      if (!p) return { p: null, si };
      if (si.status !== 'succeeded' || p.status !== 'pending_setup') return { p, si };

      const saved = extractSavedMethod(si);
      const deal = repo.dealById(p.deal_id);

      if (!isJoinable(deal, now())) {
        // The deal closed while the buyer was entering details: don't keep the method.
        await safeDetach(saved.payment_method_id);
        repo.transitionParticipant(p.id, 'pending_setup', 'released', saved, nowIso());
        return { p: repo.participantById(p.id), si, tooLate: true };
      }

      const won = repo.transitionParticipant(p.id, 'pending_setup', 'saved', saved, nowIso());
      p = repo.participantById(p.id);
      if (!won) return { p, si };
      await email('joined', deal, p);
      await engine.afterSaved(p.id);
      return { p: repo.participantById(p.id), si };
    },

    // After a payment method is saved: start charging if this buyer completed the minimum, or
    // charge right away if the deal is already on (late joiner).
    async afterSaved(participantId) {
      const p = repo.participantById(participantId);
      const deal = repo.dealById(p.deal_id);
      if (deal.status === 'open') {
        if (repo.committedCount(deal.id) >= deal.min_buyers) await engine.startCharging(deal.id);
      } else if (CHARGEABLE_DEAL.includes(deal.status)) {
        await engine.chargeParticipant(p.id);
      }
    },

    async idle() {
      while (background.size) await Promise.allSettled([...background]);
    },

    // For shutdown: wait for a running scheduler pass and all background charges.
    async drain() {
      if (ticking) await ticking.catch(() => {});
      await engine.idle();
    },

    // ---------------------------------------------------------------- charging
    // Minimum reached: open the 48-hour payment window and charge every saved method.
    async startCharging(dealId) {
      const n = now();
      const won = repo.transitionDeal(dealId, 'open', 'charging', {
        minimum_reached_at: iso(n),
        grace_ends_at: iso(addMs(n, GRACE_WINDOW_MS)),
      });
      if (won) runInBackground('charge deal', () => engine.chargeAllSaved(dealId));
      return won;
    },

    async chargeAllSaved(dealId) {
      for (const p of repo.participantsForDeal(dealId, ['saved'])) {
        if (p.next_retry_at && now() < new Date(p.next_retry_at)) continue; // backing off after a system error
        try {
          await engine.chargeParticipant(p.id);
        } catch (err) {
          console.error(`[charge] participant ${p.id}:`, err);
        }
      }
    },

    // One off-session charge attempt. Uses a single PaymentIntent per buyer (created on the first
    // attempt, re-confirmed on retries), so a buyer can never pay twice even if a retry and the
    // buyer's own fix happen at the same time.
    async chargeParticipant(participantId) {
      let p = repo.participantById(participantId);
      const deal = repo.dealById(p.deal_id);
      if (!CHARGEABLE_DEAL.includes(deal.status)) return p;
      if (!['saved', 'failed'].includes(p.status)) return p;
      if (p.status === 'failed' && p.grace_ends_at && now() >= new Date(p.grace_ends_at)) return p;

      const n = now();
      // Buyers who joined before the minimum share the deal's 48h window; later joiners get their own.
      const sharesDealWindow = deal.grace_ends_at && deal.minimum_reached_at && p.created_at <= deal.minimum_reached_at;
      const claimed = repo.transitionParticipant(
        p.id,
        p.status,
        'charging',
        {
          attempts: p.attempts + 1,
          first_charge_at: p.first_charge_at ?? iso(n),
          grace_ends_at: p.grace_ends_at ?? (sharesDealWindow ? deal.grace_ends_at : iso(addMs(n, GRACE_WINDOW_MS))),
          next_retry_at: null,
        },
        iso(n)
      );
      if (!claimed) return repo.participantById(p.id);
      const previousStatus = p.status;
      p = repo.participantById(p.id);

      // The "we're collecting now" email doubles as the SEPA pre-notification.
      if (!repo.emailsFor(p.id).some((e) => e.kind === 'minimumReached')) await email('minimumReached', deal, p);
      p = await engine.ensureFreshVat(deal, p);

      let pi;
      try {
        if (p.payment_intent_id) {
          pi = await stripe.paymentIntents.retrieve(p.payment_intent_id);
          if (!['succeeded', 'processing'].includes(pi.status)) {
            pi = await stripe.paymentIntents.confirm(
              pi.id,
              { payment_method: p.payment_method_id, off_session: true, ...mandateParam(p) },
              { idempotencyKey: `confirm-${p.id}-${p.attempts}` }
            );
          }
        } else {
          pi = await stripe.paymentIntents.create(
            {
              amount: p.amount_cents,
              currency: 'eur',
              customer: p.stripe_customer_id,
              payment_method: p.payment_method_id,
              payment_method_types: ['card', 'sepa_debit'],
              confirm: true,
              off_session: true,
              ...mandateParam(p),
              description: `${deal.product_name} (group deal #${deal.id})`,
              shipping: {
                name: p.name,
                address: { line1: p.address_line1, line2: p.address_line2 || undefined, postal_code: p.postal_code, city: p.city, country: p.country },
              },
              metadata: { deal_id: String(deal.id), participant_id: String(p.id), tax_calculation: p.tax_calculation_id ?? '' },
            },
            { idempotencyKey: `charge-${p.id}` }
          );
        }
      } catch (err) {
        const info = stripeErrorInfo(err);
        if (info.paymentIntent?.id && !p.payment_intent_id) {
          repo.updateParticipant(p.id, { payment_intent_id: info.paymentIntent.id }, nowIso());
        }
        if (err?.type === 'StripeCardError') return engine.recordFailure(p.id, info);
        // Network/API/config problem: not the buyer's fault. Undo the claim and try again soon.
        repo.transitionParticipant(
          p.id,
          'charging',
          previousStatus,
          { attempts: p.attempts - 1, next_retry_at: iso(addMs(now(), 10 * MINUTE)), last_error_message: `system: ${info.message}` },
          nowIso()
        );
        console.error(`[charge] participant ${p.id} system error:`, info.message);
        return repo.participantById(p.id);
      }
      if (pi.id !== p.payment_intent_id) repo.updateParticipant(p.id, { payment_intent_id: pi.id }, nowIso());
      return engine.applyPaymentIntent(pi);
    },

    // Stripe Tax calculations expire; refresh one that is about to before charging.
    async ensureFreshVat(deal, p) {
      if (p.tax_calculation_id && p.tax_expires_at && now() < addMs(p.tax_expires_at, -HOUR)) return p;
      const vat = await calculateVat(stripe, deal, p);
      repo.updateParticipant(p.id, vat, nowIso());
      return repo.participantById(p.id);
    },

    // Single place where a PaymentIntent's state is applied to the buyer (sync result, webhook,
    // return from the update page, or the scheduler's reconciliation).
    async applyPaymentIntent(pi) {
      if (Boolean(pi.livemode) !== liveMode) throw new Error(`Refusing to process a ${pi.livemode ? 'live' : 'test'}-mode PaymentIntent in ${liveMode ? 'live' : 'test'} mode.`);
      const p = repo.participantByPaymentIntent(pi.id) ?? repo.participantById(Number(pi.metadata?.participant_id));
      if (!p) return null;
      if (!p.payment_intent_id) repo.updateParticipant(p.id, { payment_intent_id: pi.id }, nowIso());
      // The buyer may have paid with a different method on the update page: record what was used.
      const usedPm = typeof pi.payment_method === 'object' ? pi.payment_method?.id : pi.payment_method;
      if (['succeeded', 'processing'].includes(pi.status) && usedPm && usedPm !== p.payment_method_id) {
        try {
          const described = describePaymentMethod(await stripe.paymentMethods.retrieve(usedPm));
          if (described) {
            await releaseMethod(p); // the old saved method is no longer needed
            repo.updateParticipant(p.id, described, nowIso());
          }
        } catch (err) {
          console.warn(`[pay] could not describe payment method ${usedPm}:`, err.message);
        }
      }
      switch (pi.status) {
        case 'succeeded':
          return engine.markPaid(p.id, pi);
        case 'processing':
          return engine.markProcessing(p.id);
        case 'requires_payment_method':
        case 'requires_action':
        case 'requires_confirmation': {
          const err = pi.last_payment_error ?? {};
          const info = {
            code: err.code ?? (pi.status === 'requires_action' ? 'authentication_required' : null),
            declineCode: err.decline_code ?? null,
            message: err.message ?? 'The payment was not completed.',
          };
          if (p.status === 'charging') return engine.recordFailure(p.id, info);
          if (p.status === 'processing') return engine.recordSepaFailure(p.id, info);
          return repo.participantById(p.id);
        }
        default:
          return repo.participantById(p.id);
      }
    },

    async markPaid(participantId, pi) {
      const won = repo.transitionParticipant(
        participantId,
        ['saved', 'charging', 'failed', 'processing', 'unpaid', 'late_failed'],
        'paid',
        { paid_at: nowIso(), payment_intent_id: pi.id, next_retry_at: null, needs_authentication: 0 },
        nowIso()
      );
      let p = repo.participantById(participantId);
      if (!won) return p;
      // Record the sale in Stripe Tax (for VAT/OSS reporting) only once money is actually collected.
      try {
        const tx = await stripe.tax.transactions.createFromCalculation(
          { calculation: p.tax_calculation_id, reference: pi.id, metadata: { participant_id: String(p.id) } },
          { idempotencyKey: `taxtx-${p.id}` }
        );
        repo.updateParticipant(p.id, { tax_transaction_id: tx.id }, nowIso());
      } catch (err) {
        console.error(`[tax] could not record tax transaction for participant ${p.id}:`, err.message);
        repo.updateParticipant(p.id, { last_error_message: `tax record failed: ${err.message}` }, nowIso());
      }
      p = repo.participantById(p.id);
      await releaseMethod(p); // paid: nothing more will be charged, so don't keep the method
      await email('paid', repo.dealById(p.deal_id), p);
      return p;
    },

    async markProcessing(participantId) {
      const won = repo.transitionParticipant(
        participantId,
        ['saved', 'charging', 'failed', 'unpaid'],
        'processing',
        { next_retry_at: null, needs_authentication: 0 },
        nowIso()
      );
      const p = repo.participantById(participantId);
      if (won) await email('processing', repo.dealById(p.deal_id), p);
      return p;
    },

    // A charge attempt failed (declined, or the bank wants SCA authentication).
    async recordFailure(participantId, info) {
      let p = repo.participantById(participantId);
      const needsAuth = info.code === 'authentication_required' || info.declineCode === 'authentication_required';
      const hard = HARD_DECLINES.has(info.declineCode) || HARD_DECLINES.has(info.code);
      const retryable = !needsAuth && !hard && p.payment_method_type === 'card';
      const won = repo.transitionParticipant(
        p.id,
        ['charging', 'processing'],
        'failed',
        {
          needs_authentication: needsAuth ? 1 : 0,
          last_error_code: info.declineCode || info.code || null,
          last_error_message: needsAuth ? 'Your bank requires you to confirm this payment.' : info.message,
          next_retry_at: retryable ? nextRetryAt(p) : null,
        },
        nowIso()
      );
      p = repo.participantById(p.id);
      if (!won) return p;
      if (!p.failure_email_sent_at) {
        await email(needsAuth ? 'authenticationRequired' : 'paymentFailed', repo.dealById(p.deal_id), p);
        repo.updateParticipant(p.id, { failure_email_sent_at: nowIso() }, nowIso());
      }
      return repo.participantById(p.id);
    },

    // A SEPA debit that was "processing" bounced. Inside the 48h window the buyer gets the update
    // link; after it, the order already counted it as paid, so it's flagged as your cost.
    async recordSepaFailure(participantId, info) {
      const p = repo.participantById(participantId);
      if (p.grace_ends_at && now() < new Date(p.grace_ends_at)) return engine.recordFailure(p.id, info);
      const won = repo.transitionParticipant(
        p.id,
        'processing',
        'late_failed',
        { last_error_code: info.code ?? null, last_error_message: `SEPA debit failed after the payment window: ${info.message}` },
        nowIso()
      );
      if (won) await releaseMethod(p);
      return repo.participantById(p.id);
    },

    // ---------------------------------------------------------- 48h cutoff
    // The buyer's window is over and they still haven't paid: cancel their order. Unpaid
    // amounts are the operator's cost; the buyer is never charged after this.
    async closePaymentWindow(participantId) {
      const p = repo.participantById(participantId);
      if (p.status !== 'failed') return p;
      if (p.payment_intent_id) {
        const pi = await stripe.paymentIntents.retrieve(p.payment_intent_id);
        if (['succeeded', 'processing'].includes(pi.status)) return engine.applyPaymentIntent(pi);
      }
      if (!repo.transitionParticipant(p.id, 'failed', 'unpaid', { next_retry_at: null }, nowIso())) {
        return repo.participantById(p.id);
      }
      if (p.payment_intent_id) {
        try {
          await stripe.paymentIntents.cancel(p.payment_intent_id, { cancellation_reason: 'abandoned' });
        } catch (err) {
          console.warn(`[cutoff] could not cancel ${p.payment_intent_id}:`, err.message);
        }
      }
      await releaseMethod(p);
      await email('windowClosed', repo.dealById(p.deal_id), repo.participantById(p.id));
      return repo.participantById(p.id);
    },

    // 48 hours after the minimum: the deal is ready to order. SEPA debits still processing
    // count as paid; anything that fails later is flagged (late_failed) as the operator's cost.
    async markReadyIfDue(dealId) {
      const deal = repo.dealById(dealId);
      if (deal.status !== 'charging' || now() < new Date(deal.grace_ends_at)) return false;
      for (const p of repo.participantsForDeal(deal.id, ['failed'])) {
        if (now() >= new Date(p.grace_ends_at)) await engine.closePaymentWindow(p.id);
      }
      return repo.transitionDeal(deal.id, 'charging', 'ready_to_order', { ready_at: nowIso() });
    },

    // ------------------------------------------------------------------ expiry
    // Deadline passed without the minimum: nobody is charged, every saved method is removed.
    async expireDeal(dealId) {
      const deal = repo.dealById(dealId);
      if (deal.status !== 'open' || now() < new Date(deal.deadline)) return false;
      if (repo.committedCount(deal.id) >= deal.min_buyers) return false; // the minimum was reached: charge instead
      if (!repo.transitionDeal(deal.id, 'open', 'expired', { expired_at: nowIso() })) return false;
      await engine.releaseAll(deal.id);
      return true;
    },

    async releaseAll(dealId) {
      for (const p of repo.participantsForDeal(dealId, ['pending_setup', 'saved'])) {
        try {
          await engine.releaseParticipant(p.id);
        } catch (err) {
          console.error(`[release] participant ${p.id} failed, will retry on next tick:`, err.message);
        }
      }
    },

    async releaseParticipant(participantId) {
      const p = repo.participantById(participantId);
      const deal = repo.dealById(p.deal_id);
      if (p.status === 'pending_setup') {
        if (p.setup_intent_id) {
          try {
            await stripe.setupIntents.cancel(p.setup_intent_id);
          } catch {
            /* already succeeded or canceled; finalizeSetupIntent releases it if it completes */
          }
        }
        repo.transitionParticipant(p.id, 'pending_setup', 'released', {}, nowIso());
        return;
      }
      if (p.status !== 'saved') return;
      await safeDetach(p.payment_method_id);
      if (repo.transitionParticipant(p.id, 'saved', 'released', {}, nowIso())) {
        await email('dealExpired', deal, repo.participantById(p.id));
      }
    },

    // --------------------------------------------------------------- scheduler
    // Runs every minute (in-process timer and/or POST /api/cron/tick). Each job is independent.
    // Returns false if another process currently holds the scheduler lock.
    async tick() {
      if (ticking) return ticking;
      if (!repo.acquireLock('scheduler', instanceId, now(), TICK_LEASE_MS)) return false;
      ticking = (async () => {
        const jobs = [
          ['expire deals past deadline', async () => {
            for (const d of repo.dealsByStatus('open')) {
              if (now() >= new Date(d.deadline)) await engine.expireDeal(d.id);
            }
          }],
          ['finish releasing expired deals', async () => {
            for (const d of repo.dealsByStatus('expired')) await engine.releaseAll(d.id);
          }],
          ['start charging deals that reached the minimum', async () => {
            for (const d of repo.dealsByStatus('open')) {
              if (repo.committedCount(d.id) >= d.min_buyers) await engine.startCharging(d.id);
            }
          }],
          ['charge saved methods on deals that are on', async () => {
            for (const status of CHARGEABLE_DEAL) {
              for (const d of repo.dealsByStatus(status)) await engine.chargeAllSaved(d.id);
            }
          }],
          ['reconcile charges stuck mid-attempt', () => engine.reconcileStuck()],
          ['retry failed charges that are due', async () => {
            const due = repo.participantsWhere(
              `status = 'failed' AND next_retry_at IS NOT NULL AND next_retry_at <= :now AND grace_ends_at > :now`,
              { now: nowIso() }
            );
            for (const p of due) await engine.chargeParticipant(p.id);
          }],
          ['close payment windows that ended', async () => {
            const due = repo.participantsWhere(`status = 'failed' AND grace_ends_at <= :now`, { now: nowIso() });
            for (const p of due) await engine.closePaymentWindow(p.id);
          }],
          ['mark deals ready to order', async () => {
            for (const d of repo.dealsByStatus('charging')) await engine.markReadyIfDue(d.id);
          }],
          ['anonymise sign-ups that ended long ago', async () => {
            // At most once an hour: it only removes data that is no longer needed.
            if (now().getTime() - lastPrivacyRun < HOUR) return;
            lastPrivacyRun = now().getTime();
            await anonymiseOldSignups(ctx);
          }],
          ['remind buyers 24h before their payment window closes', async () => {
            const n = now();
            const due = repo.participantsWhere(
              `status = 'failed' AND reminder_sent_at IS NULL AND grace_ends_at > :now AND grace_ends_at <= :soon
               AND (failure_email_sent_at IS NULL OR failure_email_sent_at <= :quiet)`,
              { now: iso(n), soon: iso(addMs(n, 24 * HOUR)), quiet: iso(addMs(n, -6 * HOUR)) }
            );
            for (const p of due) {
              if (repo.claimReminder(p.id, iso(n))) {
                await email('reminder', repo.dealById(p.deal_id), repo.participantById(p.id));
              }
            }
          }],
        ];
        for (const [name, run] of jobs) {
          try {
            await run();
          } catch (err) {
            console.error(`[tick] ${name} failed:`, err);
          }
        }
      })();
      try {
        await ticking;
        await engine.idle();
      } finally {
        ticking = null;
        repo.releaseLock('scheduler', instanceId);
      }
      return true;
    },

    // A process crash between "claim" and "apply result" leaves a buyer in 'charging'. Ask Stripe.
    async reconcileStuck() {
      const cutoff = iso(addMs(now(), -15 * MINUTE));
      for (const p of repo.participantsWhere(`status = 'charging' AND updated_at < :cutoff`, { cutoff })) {
        if (p.payment_intent_id) {
          await engine.applyPaymentIntent(await stripe.paymentIntents.retrieve(p.payment_intent_id));
        }
        const fresh = repo.participantById(p.id);
        if (fresh.status === 'charging') {
          repo.transitionParticipant(p.id, 'charging', p.attempts > 1 ? 'failed' : 'saved', { next_retry_at: nowIso() }, nowIso());
        }
      }
    },

    // -------------------------------------------------------------- withdrawal
    // EU right of withdrawal (and withdrawing an order before the deal is on): run by the admin
    // when a buyer asks. Unpaid buyers are released; paid buyers are refunded in full and the
    // Stripe Tax transaction is reversed.
    // notify: false when the buyer already got an acknowledgement (src/withdrawals.js).
    async withdraw(participantId, { notify = true } = {}) {
      const p = repo.participantById(participantId);
      const deal = repo.dealById(p.deal_id);
      const n = nowIso();
      if (['pending_setup', 'saved', 'failed', 'unpaid', 'late_failed'].includes(p.status)) {
        if (p.payment_intent_id && p.status === 'failed') {
          try {
            await stripe.paymentIntents.cancel(p.payment_intent_id, { cancellation_reason: 'requested_by_customer' });
          } catch (err) {
            console.warn(`[withdraw] cancel ${p.payment_intent_id}:`, err.message);
          }
        }
        if (p.setup_intent_id && p.status === 'pending_setup') {
          try {
            await stripe.setupIntents.cancel(p.setup_intent_id);
          } catch {
            /* already finished */
          }
        }
        await releaseMethod(p);
        if (!repo.transitionParticipant(p.id, p.status, 'withdrawn', { next_retry_at: null }, n)) {
          throw new Error('The buyer changed state meanwhile; reload and try again.');
        }
      } else if (p.status === 'paid') {
        const refund = await stripe.refunds.create(
          { payment_intent: p.payment_intent_id, reason: 'requested_by_customer', metadata: { participant_id: String(p.id) } },
          { idempotencyKey: `refund-${p.id}` }
        );
        if (p.tax_transaction_id) {
          try {
            await stripe.tax.transactions.createReversal(
              { mode: 'full', original_transaction: p.tax_transaction_id, reference: `refund-${refund.id}` },
              { idempotencyKey: `taxrev-${p.id}` }
            );
          } catch (err) {
            console.error(`[tax] reversal for participant ${p.id} failed:`, err.message);
          }
        }
        repo.transitionParticipant(p.id, 'paid', 'withdrawn', { refund_id: refund.id }, n);
      } else if (p.status === 'processing') {
        throw new Error('This SEPA debit is still processing. Refund it once it has settled.');
      } else {
        throw new Error(`Nothing to withdraw (status: ${p.status}).`);
      }
      const updated = repo.participantById(p.id);
      if (notify) await email('withdrawn', deal, updated);
      return updated;
    },

    // ----------------------------------------------------------------- webhooks
    async handleEvent(event) {
      const obj = event.data?.object;
      switch (event.type) {
        case 'setup_intent.succeeded':
          await engine.finalizeSetupIntent(obj.id);
          break;
        case 'payment_intent.succeeded':
        case 'payment_intent.processing':
        case 'payment_intent.payment_failed':
          // Always act on the current state, not the (possibly out-of-order) event payload.
          await engine.applyPaymentIntent(await stripe.paymentIntents.retrieve(obj.id));
          break;
        default:
          break;
      }
    },
  };

  return engine;
}

function mandateParam(p) {
  return p.payment_method_type === 'sepa_debit' && p.mandate_id ? { mandate: p.mandate_id } : {};
}

// Next automatic retry for a declined card, or null if no retries are left in the window.
export function nextRetryAt(p) {
  const offset = RETRY_OFFSETS_MS[p.attempts - 1];
  if (!offset || !p.first_charge_at) return null;
  const at = addMs(p.first_charge_at, offset);
  return p.grace_ends_at && at >= new Date(p.grace_ends_at) ? null : at.toISOString();
}
