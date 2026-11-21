// An in-memory stand-in for the parts of the Stripe API the shop uses, with the behaviour of
// Stripe's test cards and IBANs, so the payment scenarios run without a network or a Stripe
// account. Test helpers (not Stripe API) start with an underscore.
//
// Behaviours of a saved payment method (set when the buyer "completes" the SetupIntent):
//   card_ok            charges succeed
//   card_declined      every charge is declined (like 4000 0000 0000 0341)
//   card_sca           every off-session charge needs 3-D Secure (like 4000 0027 6000 3184)
//   card_hard          declined as stolen (no automatic retries)
//   sepa_ok / sepa_fail   debits go to "processing"; _settle() makes them succeed or fail
//   ideal              iDEAL setup that generates a SEPA mandate (behaves like sepa_ok)

const VAT = { DE: 19, AT: 20, NL: 21, EE: 22, FR: 20, IT: 22, ES: 21, FI: 25.5, IE: 23, BE: 21 };

class StripeError extends Error {
  constructor(type, fields) {
    super(fields.message);
    Object.assign(this, { type, ...fields, raw: { ...fields } });
  }
}

export function createFakeStripe({ clock = { now: () => new Date() }, livemode = false } = {}) {
  let seq = 0;
  const id = (prefix) => `${prefix}_${(++seq).toString().padStart(6, '0')}`;
  const store = { customers: new Map(), setupIntents: new Map(), paymentIntents: new Map(), paymentMethods: new Map(), refunds: new Map(), calcs: new Map(), taxTx: new Map(), reversals: new Map() };
  const idem = new Map();
  const calls = [];
  const failNext = new Map(); // method name -> error to throw once (simulated outages)
  const nowSec = () => Math.floor(clock.now().getTime() / 1000);

  // Same idempotency key and same call: the stored result, like Stripe.
  const once = (name, opts, fn) => {
    calls.push(name);
    if (failNext.has(name)) {
      const err = failNext.get(name);
      failNext.delete(name);
      throw err;
    }
    const key = opts?.idempotencyKey ? `${name}:${opts.idempotencyKey}` : null;
    if (key && idem.has(key)) return structuredClone(idem.get(key));
    const out = fn();
    if (key) idem.set(key, structuredClone(out));
    return structuredClone(out);
  };
  const get = (map, objId, what) => {
    const obj = map.get(objId);
    if (!obj) throw new StripeError('StripeInvalidRequestError', { code: 'resource_missing', message: `No such ${what}: '${objId}'` });
    return obj;
  };

  // What happens when a PaymentIntent is confirmed with a saved method.
  function attempt(pi, { offSession }) {
    const pm = get(store.paymentMethods, pi.payment_method, 'payment_method');
    pi.payment_method = pm.id;
    const b = pm._behaviour;
    if (b === 'card_ok' || (b === 'card_sca' && !offSession)) {
      pi.status = 'succeeded';
      pi.last_payment_error = null;
      return pi;
    }
    if (b === 'sepa_ok' || b === 'sepa_fail' || b === 'ideal') {
      pi.status = 'processing';
      return pi;
    }
    const error =
      b === 'card_sca'
        ? { code: 'authentication_required', decline_code: 'authentication_required', message: 'Your card was declined. This transaction requires authentication.' }
        : b === 'card_hard'
          ? { code: 'card_declined', decline_code: 'stolen_card', message: 'Your card was declined.' }
          : { code: 'card_declined', decline_code: 'insufficient_funds', message: 'Your card has insufficient funds.' };
    pi.status = b === 'card_sca' ? 'requires_action' : 'requires_payment_method';
    pi.last_payment_error = { ...error, type: 'card_error' };
    throw new StripeError('StripeCardError', { ...error, payment_intent: structuredClone(pi) });
  }

  const stripe = {
    _store: store,
    _calls: calls,
    // Simulates an outage: the next call to `name` (e.g. 'paymentIntents.create') throws.
    _failNext(name, err = new StripeError('StripeAPIError', { message: 'Stripe is having a moment' })) {
      failNext.set(name, err);
    },
    // The buyer finishes the Payment Element: the SetupIntent succeeds with a method that behaves
    // as `behaviour`.
    _completeSetup(siId, behaviour = 'card_ok') {
      const si = get(store.setupIntents, siId, 'setup_intent');
      const isSepa = behaviour.startsWith('sepa') || behaviour === 'ideal';
      const pm = {
        id: id('pm'),
        object: 'payment_method',
        type: isSepa ? 'sepa_debit' : 'card',
        card: isSepa ? undefined : { brand: 'visa', last4: { card_ok: '4242', card_declined: '0341', card_sca: '3184', card_hard: '0019' }[behaviour] ?? '4242' },
        sepa_debit: isSepa ? { country: 'DE', last4: behaviour === 'sepa_fail' ? '3001' : '3000' } : undefined,
        customer: si.customer,
        _behaviour: behaviour,
      };
      store.paymentMethods.set(pm.id, pm);
      si.status = 'succeeded';
      if (behaviour === 'ideal') {
        const ideal = { id: id('pm'), object: 'payment_method', type: 'ideal', customer: si.customer };
        store.paymentMethods.set(ideal.id, ideal);
        si.payment_method = ideal.id;
        si._latest_attempt = { payment_method_details: { type: 'ideal', ideal: { bank: 'ing', iban_last4: '5264', generated_sepa_debit: pm.id, generated_sepa_debit_mandate: id('mandate') } } };
      } else {
        si.payment_method = pm.id;
        si.mandate = isSepa ? id('mandate') : null;
        si._latest_attempt = { payment_method_details: { type: pm.type } };
      }
      return structuredClone(si);
    },
    // A SEPA debit (or iDEAL-generated SEPA) settles: succeeded, or bounced.
    _settle(piId, ok = true) {
      const pi = get(store.paymentIntents, piId, 'payment_intent');
      if (ok) {
        pi.status = 'succeeded';
        pi.last_payment_error = null;
      } else {
        pi.status = 'requires_payment_method';
        pi.last_payment_error = { code: 'insufficient_funds', message: 'The account has insufficient funds.', type: 'card_error' };
      }
      return structuredClone(pi);
    },
    // The buyer pays on the /pay page (on-session, e.g. with 3-D Secure, or a new card).
    _payOnSession(piId, behaviour = null) {
      const pi = get(store.paymentIntents, piId, 'payment_intent');
      if (behaviour) {
        const pm = { id: id('pm'), object: 'payment_method', type: behaviour.startsWith('sepa') ? 'sepa_debit' : 'card', card: { brand: 'mastercard', last4: '4444' }, sepa_debit: { country: 'NL', last4: '4321' }, _behaviour: behaviour };
        store.paymentMethods.set(pm.id, pm);
        pi.payment_method = pm.id;
      }
      try {
        attempt(pi, { offSession: false });
      } catch {
        /* the buyer sees the error on the page */
      }
      return structuredClone(pi);
    },
    _event(type, object) {
      return { id: id('evt'), type, livemode, data: { object } };
    },

    customers: {
      create: async (params, opts) => once('customers.create', opts, () => {
        const c = { id: id('cus'), object: 'customer', ...params };
        store.customers.set(c.id, c);
        return c;
      }),
      update: async (cid, params) => once('customers.update', null, () => Object.assign(get(store.customers, cid, 'customer'), params)),
      del: async (cid) => once('customers.del', null, () => {
        get(store.customers, cid, 'customer');
        store.customers.delete(cid);
        return { id: cid, deleted: true };
      }),
    },

    tax: {
      calculations: {
        create: async (params, opts) => once('tax.calculations.create', opts, () => {
          const country = params.customer_details.address.country;
          if (!/^\d{3,6}$/.test(String(params.customer_details.address.postal_code).replace(/\D/g, '')) || !params.customer_details.address.postal_code) {
            throw new StripeError('StripeInvalidRequestError', { code: 'customer_tax_location_invalid', message: 'Invalid address' });
          }
          const amount = params.line_items.reduce((n, l) => n + l.amount * (l.quantity ?? 1), 0);
          const rate = VAT[country] ?? 21;
          const tax = Math.round(amount - amount / (1 + rate / 100));
          const calc = {
            id: id('taxcalc'),
            object: 'tax.calculation',
            amount_total: amount,
            tax_amount_inclusive: tax,
            expires_at: nowSec() + 90 * 24 * 3600,
            tax_breakdown: [{ taxability_reason: 'standard_rated', tax_rate_details: { percentage_decimal: String(rate), country } }],
          };
          store.calcs.set(calc.id, calc);
          return calc;
        }),
      },
      transactions: {
        createFromCalculation: async (params, opts) => once('tax.transactions.createFromCalculation', opts, () => {
          get(store.calcs, params.calculation, 'tax.calculation');
          const tx = { id: id('tax_tx'), object: 'tax.transaction', reference: params.reference };
          store.taxTx.set(tx.id, tx);
          return tx;
        }),
        createReversal: async (params, opts) => once('tax.transactions.createReversal', opts, () => {
          get(store.taxTx, params.original_transaction, 'tax.transaction');
          const tx = { id: id('tax_tx'), object: 'tax.transaction', type: 'reversal', original: params.original_transaction };
          store.reversals.set(tx.id, tx);
          return tx;
        }),
      },
    },

    setupIntents: {
      create: async (params, opts) => once('setupIntents.create', opts, () => {
        const si = { id: id('seti'), object: 'setup_intent', status: 'requires_payment_method', livemode, client_secret: `seti_secret_${seq}`, payment_method: null, mandate: null, ...params };
        store.setupIntents.set(si.id, si);
        return si;
      }),
      retrieve: async (siId, params) => once('setupIntents.retrieve', null, () => {
        const si = structuredClone(get(store.setupIntents, siId, 'setup_intent'));
        const expand = params?.expand ?? [];
        if (expand.includes('payment_method') && si.payment_method) si.payment_method = structuredClone(store.paymentMethods.get(si.payment_method));
        if (expand.includes('latest_attempt')) si.latest_attempt = si._latest_attempt ?? null;
        return si;
      }),
      cancel: async (siId) => once('setupIntents.cancel', null, () => {
        const si = get(store.setupIntents, siId, 'setup_intent');
        if (si.status === 'succeeded') throw new StripeError('StripeInvalidRequestError', { code: 'setup_intent_unexpected_state', message: 'Cannot cancel a succeeded SetupIntent' });
        si.status = 'canceled';
        return si;
      }),
    },

    paymentMethods: {
      retrieve: async (pmId) => once('paymentMethods.retrieve', null, () => get(store.paymentMethods, pmId, 'payment_method')),
      detach: async (pmId) => once('paymentMethods.detach', null, () => {
        const pm = get(store.paymentMethods, pmId, 'payment_method');
        if (!pm.customer) throw new StripeError('StripeInvalidRequestError', { code: 'payment_method_unexpected_state', message: 'The payment method is not attached to a customer' });
        pm.customer = null;
        return pm;
      }),
    },

    paymentIntents: {
      create: async (params, opts) => {
        const key = opts?.idempotencyKey ? `paymentIntents.create:${opts.idempotencyKey}` : null;
        if (key && idem.has(key)) {
          calls.push('paymentIntents.create');
          const stored = idem.get(key);
          if (stored instanceof Error) throw stored;
          return structuredClone(stored);
        }
        return once('paymentIntents.create', null, () => {
          const pi = { id: id('pi'), object: 'payment_intent', status: 'requires_confirmation', livemode, client_secret: `pi_secret_${seq}`, last_payment_error: null, ...params };
          store.paymentIntents.set(pi.id, pi);
          try {
            if (params.confirm) attempt(pi, { offSession: params.off_session });
          } catch (err) {
            if (key) idem.set(key, err);
            throw err;
          }
          if (key) idem.set(key, structuredClone(pi));
          return pi;
        });
      },
      retrieve: async (piId) => once('paymentIntents.retrieve', null, () => get(store.paymentIntents, piId, 'payment_intent')),
      confirm: async (piId, params, opts) => once('paymentIntents.confirm', opts, () => {
        const pi = get(store.paymentIntents, piId, 'payment_intent');
        if (['succeeded', 'canceled'].includes(pi.status)) throw new StripeError('StripeInvalidRequestError', { code: 'payment_intent_unexpected_state', message: `PaymentIntent is ${pi.status}` });
        if (params?.payment_method) pi.payment_method = params.payment_method;
        return attempt(pi, { offSession: params?.off_session });
      }),
      cancel: async (piId, params) => once('paymentIntents.cancel', null, () => {
        const pi = get(store.paymentIntents, piId, 'payment_intent');
        if (['succeeded', 'processing'].includes(pi.status)) throw new StripeError('StripeInvalidRequestError', { code: 'payment_intent_unexpected_state', message: `Cannot cancel a ${pi.status} PaymentIntent` });
        pi.status = 'canceled';
        pi.cancellation_reason = params?.cancellation_reason;
        return pi;
      }),
    },

    refunds: {
      create: async (params, opts) => once('refunds.create', opts, () => {
        const pi = get(store.paymentIntents, params.payment_intent, 'payment_intent');
        if (pi.status !== 'succeeded') throw new StripeError('StripeInvalidRequestError', { code: 'charge_not_refundable', message: 'Only succeeded payments can be refunded' });
        const r = { id: id('re'), object: 'refund', amount: pi.amount, payment_intent: pi.id, status: 'succeeded' };
        store.refunds.set(r.id, r);
        return r;
      }),
    },

    webhooks: {
      constructEvent: (body) => JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : body),
    },
  };
  return stripe;
}
