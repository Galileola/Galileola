// Thin helpers around the Stripe API calls this app makes.

// ---------------------------------------------------------------- Stripe Tax
// The deal price is a fixed gross amount (VAT included). Stripe Tax works out how much of it
// is VAT for the buyer's delivery country (tax_behavior: 'inclusive'), so amount_total equals
// the deal price for everyone and only the VAT share differs.
export async function calculateVat(stripe, deal, participant, { idempotencyKey } = {}) {
  const calc = await stripe.tax.calculations.create(
    {
      currency: 'eur',
      line_items: [
        {
          amount: deal.price_cents,
          quantity: 1,
          reference: `deal-${deal.id}`,
          tax_behavior: 'inclusive',
          tax_code: deal.tax_code,
        },
      ],
      customer_details: {
        address: {
          line1: participant.address_line1,
          line2: participant.address_line2 || undefined,
          postal_code: participant.postal_code,
          city: participant.city,
          country: participant.country,
        },
        // Downloads (src/digital.js) are taxed where the buyer lives: their billing address.
        address_source: deal.kind === 'digital' ? 'billing' : 'shipping',
      },
    },
    idempotencyKey ? { idempotencyKey } : undefined
  );
  const breakdown = calc.tax_breakdown?.[0];
  let label = '';
  if (breakdown) {
    const pct = breakdown.tax_rate_details?.percentage_decimal;
    label =
      breakdown.taxability_reason === 'not_collecting'
        ? 'VAT not collected (no registration)'
        : `${Number(pct ?? 0)}% VAT ${breakdown.tax_rate_details?.country ?? participant.country}`;
  }
  return {
    tax_calculation_id: calc.id,
    amount_cents: calc.amount_total,
    tax_cents: calc.tax_amount_inclusive ?? 0,
    tax_rate_label: label,
    tax_expires_at: calc.expires_at ? new Date(calc.expires_at * 1000).toISOString() : null,
  };
}

// ----------------------------------------------------- payment method types
// Cards + SEPA Direct Debit, plus iDEAL used only to set up a SEPA mandate (a SetupIntent
// with iDEAL produces a reusable sepa_debit PaymentMethod). If the account hasn't activated
// iDEAL (or SEPA), Stripe rejects the type and we drop it for the rest of the process.
export function createSetupIntentFactory(stripe, { initialTypes = ['card', 'sepa_debit', 'ideal'] } = {}) {
  let types = [...initialTypes];

  const dropUnavailable = (err) => {
    if (err?.type !== 'StripeInvalidRequestError') return false;
    const msg = `${err.message ?? ''} ${err.param ?? ''}`;
    const bad = types.find((t) => t !== 'card' && msg.includes(t));
    if (!bad) return false;
    console.warn(`[stripe] Payment method type "${bad}" is not available on this account; continuing without it.`);
    types = types.filter((t) => t !== bad && !(bad === 'sepa_debit' && t === 'ideal'));
    return true;
  };

  return {
    get types() {
      return [...types];
    },
    async create(params, keyPrefix) {
      for (;;) {
        try {
          return await stripe.setupIntents.create(
            { ...params, payment_method_types: types },
            { idempotencyKey: `${keyPrefix}-${types.join('_')}` }
          );
        } catch (err) {
          if (!dropUnavailable(err)) throw err;
        }
      }
    },
  };
}

// The PaymentMethod we can charge later. For iDEAL, Stripe generates a SEPA Direct Debit
// PaymentMethod + mandate during setup; the iDEAL method itself can't be reused.
// `si` must be retrieved with expand: ['payment_method', 'latest_attempt'].
export function extractSavedMethod(si) {
  const details = si.latest_attempt?.payment_method_details;
  const idOf = (x) => (x && typeof x === 'object' ? x.id : x) || null;

  if (details?.type === 'ideal' && details.ideal?.generated_sepa_debit) {
    return {
      payment_method_id: idOf(details.ideal.generated_sepa_debit),
      payment_method_type: 'sepa_debit',
      mandate_id: idOf(details.ideal.generated_sepa_debit_mandate),
      payment_method_label: `SEPA Direct Debit via iDEAL${details.ideal.bank ? ` (${details.ideal.bank})` : ''}${details.ideal.iban_last4 ? ` •••• ${details.ideal.iban_last4}` : ''}`,
    };
  }

  const pm = si.payment_method;
  if (!pm || typeof pm !== 'object') throw new Error(`SetupIntent ${si.id} has no expanded payment_method`);
  const described = describePaymentMethod(pm);
  if (!described) throw new Error(`Unsupported payment method type for later charges: ${pm.type}`);
  return { ...described, mandate_id: pm.type === 'sepa_debit' ? idOf(si.mandate) : null };
}

// Label + type for a card or SEPA PaymentMethod object; null for anything else.
export function describePaymentMethod(pm) {
  if (pm.type === 'card') {
    const brand = pm.card?.brand ? pm.card.brand[0].toUpperCase() + pm.card.brand.slice(1) : 'Card';
    return { payment_method_id: pm.id, payment_method_type: 'card', payment_method_label: `${brand} •••• ${pm.card?.last4 ?? '????'}` };
  }
  if (pm.type === 'sepa_debit') {
    return {
      payment_method_id: pm.id,
      payment_method_type: 'sepa_debit',
      payment_method_label: `SEPA Direct Debit${pm.sepa_debit?.country ? ` (${pm.sepa_debit.country})` : ''} •••• ${pm.sepa_debit?.last4 ?? '????'}`,
    };
  }
  return null;
}

export function stripeErrorInfo(err) {
  return {
    type: err?.type,
    code: err?.code || err?.raw?.code || null,
    declineCode: err?.decline_code || err?.raw?.decline_code || null,
    message: err?.raw?.message || err?.message || 'Unknown error',
    paymentIntent: err?.payment_intent || err?.raw?.payment_intent || null,
  };
}
