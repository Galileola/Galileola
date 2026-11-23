import { forLanguage } from './i18n/index.js';

// Plain-text email templates, in the buyer's language (p.lang, saved when they joined; texts in
// src/i18n/locales). Every template gets ({ deal, p, baseUrl, business, now, i18n }), where deal
// already has its name in that language when a translation exists. Links carry ?lang= so the page
// opens in the same language as the email.
const sign = (business) => `\n\n${business.name}\n${business.address}\n${business.email}${business.phone ? `\n${business.phone}` : ''}`;

function helpers({ deal, p, baseUrl, i18n }) {
  const { t, formatEuro } = i18n;
  const q = `?lang=${i18n.lang}`;
  return {
    t,
    name: deal.product_name,
    amount:
      p.tax_cents != null
        ? t('email.amountWithVat', { amount: formatEuro(p.amount_cents ?? deal.price_cents), vat: formatEuro(p.tax_cents) })
        : t('email.amount', { amount: formatEuro(p.amount_cents ?? deal.price_cents) }),
    method: p.payment_method_label ? t('email.method', { method: p.payment_method_label }) : '',
    payLink: `${baseUrl}/pay/${p.token}${q}`,
    dealLink: `${baseUrl}/deals/${deal.slug}${q}`,
    termsLink: `${baseUrl}/terms${q}`,
    withdrawalLink: `${baseUrl}/terms${q}#withdrawal`,
    // The online withdrawal function, opened for this buyer's order (src/withdrawals.js).
    withdrawLink: `${baseUrl}/withdraw?order=${encodeURIComponent(p.token)}&lang=${i18n.lang}`,
    // Digital products (src/digital.js): the buyer's personal download page.
    digital: deal.kind === 'digital',
    downloadLink: `${baseUrl}/download/${p.token}${q}`,
  };
}

export const templates = {
  joined: (data) => {
    const { deal, p, business, i18n } = data;
    const { t, name, amount, method, dealLink, termsLink, withdrawLink, digital } = helpers(data);
    // A download: confirms, on a durable medium, that the buyer asked for it as soon as they have
    // paid and knows they then lose the right of withdrawal (Directive 2011/83/EU, Art. 8(7)).
    const withdrawal = digital && p.download_consent_at ? t('email.digitalConsentJoined') : t('email.withdrawalRight', { link: termsLink });
    const intro =
      deal.status === 'open'
        ? `${t('email.joinedOpen', { name })}

${t('email.joinedNext')}
- ${t('email.joinedIfReached', { min: deal.min_buyers, date: i18n.formatDate(deal.deadline), amount })}
- ${t('email.joinedIfNot')}`
        : t('email.joinedReached', { name, amount });
    return {
      subject: t('email.joinedSubject', { name }),
      body: `${t('email.hi', { name: p.name })}

${intro}

${method}
${t('email.dealPage', { link: dealLink })}

${withdrawal}
${t('withdraw.emailHere', { link: withdrawLink })}${sign(business)}`,
    };
  },

  // Doubles as the SEPA pre-notification (amount + collection date).
  minimumReached: (data) => {
    const { deal, p, business, now, i18n } = data;
    const { t, name, amount, method } = helpers(data);
    const sepa =
      p.payment_method_type === 'sepa_debit'
        ? `\n${t('email.reachedSepa', { amount: i18n.formatEuro(p.amount_cents ?? deal.price_cents), date: i18n.formatDate(now) })}\n`
        : '';
    return {
      subject: t('email.reachedSubject', { name }),
      body: `${t('email.hi', { name: p.name })}

${t('email.reachedIntro', { name, min: deal.min_buyers })}

${t('email.reachedCollecting', { amount })}
${method}
${sepa}
${t('email.reachedIfFails')}${sign(business)}`,
    };
  },

  paid: (data) => {
    const { p, business } = data;
    const { t, name, amount, method, withdrawalLink, withdrawLink, digital, downloadLink } = helpers(data);
    if (digital) {
      // The download is available now; with the buyer's consent the right of withdrawal has ended,
      // which this email confirms (Directive 2011/83/EU, Art. 8(7) and 16(m)).
      return {
        subject: t('email.paidSubject', { name }),
        body: `${t('email.hi', { name: p.name })}

${t('email.paidText', { amount, name })}
${method}

${t('email.downloadReady', { link: downloadLink })}

${p.download_consent_at ? t('email.digitalConsentPaid') : `${t('email.withdrawalRight', { link: withdrawalLink })}\n${t('withdraw.emailHere', { link: withdrawLink })}`}${sign(business)}`,
      };
    }
    return {
      subject: t('email.paidSubject', { name }),
      body: `${t('email.hi', { name: p.name })}

${t('email.paidText', { amount, name })}
${method}

${t('email.paidConfirmed')}
${t('email.paidWithdrawal', { link: withdrawalLink })}
${t('withdraw.emailHere', { link: withdrawLink })}${sign(business)}`,
    };
  },

  processing: (data) => {
    const { p, business } = data;
    const { t, name, amount, digital } = helpers(data);
    return {
      subject: t('email.processingSubject', { name }),
      body: `${t('email.hi', { name: p.name })}

${t('email.processingText', { amount, name })}
${t('email.processingTime')}${digital ? `\n${t('download.afterDebit')}` : ''}${sign(business)}`,
    };
  },

  paymentFailed: (data) => {
    const { p, business, i18n } = data;
    const { t, name, amount, payLink } = helpers(data);
    const what = p.last_error_message
      ? t('email.failedTextReason', { amount, name, reason: p.last_error_message })
      : t('email.failedText', { amount, name });
    return {
      subject: t('email.failedSubject', { name }),
      body: `${t('email.hi', { name: p.name })}

${what}

${t('email.failedUpdate', { date: i18n.formatDate(p.grace_ends_at) })}
${payLink}

${t('email.failedRetry')}${sign(business)}`,
    };
  },

  authenticationRequired: (data) => {
    const { p, business, i18n } = data;
    const { t, name, amount, payLink } = helpers(data);
    return {
      subject: t('email.authSubject', { name }),
      body: `${t('email.hi', { name: p.name })}

${t('email.authText', { name, amount })}

${t('email.authConfirm', { date: i18n.formatDate(p.grace_ends_at) })}
${payLink}

${t('email.authIfNot')}${sign(business)}`,
    };
  },

  reminder: (data) => {
    const { p, business, i18n } = data;
    const { t, name, amount, payLink } = helpers(data);
    return {
      subject: t('email.reminderSubject', { name }),
      body: `${t('email.hi', { name: p.name })}

${t('email.reminderText', { amount, name })}
${t('email.reminderUntil', { date: i18n.formatDate(p.grace_ends_at) })}
${payLink}${sign(business)}`,
    };
  },

  windowClosed: (data) => {
    const { p, business } = data;
    const { t, name } = helpers(data);
    return {
      subject: t('email.closedSubject', { name }),
      body: `${t('email.hi', { name: p.name })}

${t('email.closedText', { name })}
${t('email.notCharged')}${sign(business)}`,
    };
  },

  dealExpired: (data) => {
    const { deal, p, business, i18n } = data;
    const { t, name } = helpers(data);
    if (deal.cancelled_at) {
      return {
        subject: t('email.cancelledSubject', { name }),
        body: `${t('email.hi', { name: p.name })}

${t('email.cancelledText', { name })}

${t('email.expiredNobody')}${sign(business)}`,
      };
    }
    return {
      subject: t('email.expiredSubject', { name }),
      body: `${t('email.hi', { name: p.name })}

${t('email.expiredText', { name, min: deal.min_buyers, date: i18n.formatDate(deal.deadline) })}

${t('email.expiredNobody')}${sign(business)}`,
    };
  },

  withdrawn: (data) => {
    const { p, business, i18n } = data;
    const { t, name } = helpers(data);
    return {
      subject: t('email.withdrawnSubject', { name }),
      body: `${t('email.hi', { name: p.name })}

${t('email.withdrawnText', { name })}
${p.refund_id ? t('email.withdrawnRefund', { amount: i18n.formatEuro(p.amount_cents) }) : t('email.withdrawnNoCharge')}${sign(business)}`,
    };
  },
};

// Shipping and the owner's messages (src/fulfilment.js).
Object.assign(templates, {
  shipped: (data) => {
    const { p, business } = data;
    const { t, name, dealLink } = helpers(data);
    const tracking = [
      p.tracking_number ? t('email.shippedTracking', { tracking: p.tracking_number }) : '',
      p.tracking_url ? t('email.shippedTrackingLink', { link: p.tracking_url }) : '',
    ].filter(Boolean).join('\n');
    return {
      subject: t('email.shippedSubject', { name }),
      body: `${t('email.hi', { name: p.name })}

${t('email.shippedText', { name })}
${tracking ? `\n${tracking}\n` : ''}
${t('email.dealPage', { link: dealLink })}${sign(business)}`,
    };
  },

  message: (data) => {
    const { p, business, message } = data;
    const { t, name } = helpers(data);
    return {
      subject: message.subject,
      body: `${t('email.hi', { name: p.name })}

${message.body}

${t('email.messageFooter', { name })}${sign(business)}`,
    };
  },
});

// Deal alerts (src/alerts.js): data = { sub, shop, baseUrl, business, deal?, lang }.
Object.assign(templates, {
  alertConfirm: (data) => {
    const { business, shop, sub, baseUrl, i18n } = data;
    const { t } = i18n;
    return {
      subject: t('alerts.confirmSubject', { shop }),
      body: `${t('alerts.confirmText', { shop })}
${baseUrl}/alerts/confirm/${sub.token}?lang=${i18n.lang}

${t('alerts.confirmIgnore')}${sign(business)}`,
    };
  },

  newDeal: (data) => {
    const { business, sub, deal, baseUrl, i18n } = data;
    const { t } = i18n;
    const q = `?lang=${i18n.lang}&utm_source=deal-alert&utm_medium=email`;
    return {
      subject: t('alerts.newDealSubject', { name: deal.product_name }),
      body: `${t('alerts.newDealText', { name: deal.product_name, price: i18n.formatEuro(deal.price_cents), date: i18n.formatDate(deal.deadline) })}
${baseUrl}/deals/${deal.slug}${q}
${deal.headline ? `\n${deal.headline}\n` : ''}
${t('alerts.unsubscribe', { link: `${baseUrl}/alerts/unsubscribe/${sub.token}?lang=${i18n.lang}` })}${sign(business)}`,
    };
  },
});

// The online withdrawal function (src/withdrawals.js): the acknowledgement the buyer must get, with
// what they sent and the date and time, and the shop's copy (in English, like the admin).
Object.assign(templates, {
  withdrawalReceived: (data) => {
    const { withdrawal: w, outcome, business, i18n } = data;
    const { t } = i18n;
    const sent = [
      `${t('withdraw.order')}: ${w.order_text}`,
      `${t('withdraw.name')}: ${w.name}`,
      `${t('withdraw.email')}: ${w.email}`,
      w.message ? `${t('withdraw.messageLabel')}: ${w.message}` : '',
    ].filter(Boolean);
    const next = { cancelled: 'withdraw.doneCancelled', refund: 'withdraw.doneRefund', review: 'withdraw.doneReview', ended: 'withdraw.doneEnded', digital: 'withdraw.doneDigital' }[outcome];
    return {
      subject: t('withdraw.emailSubject', { reference: w.reference }),
      body: `${t('email.hi', { name: w.name })}

${t('withdraw.emailText', { date: i18n.formatDate(w.created_at), reference: w.reference })}

${sent.join('\n')}

${t(next)}${sign(business)}`,
    };
  },
  withdrawalNotice: (data) => {
    const { withdrawal: w, baseUrl, i18n } = data;
    return {
      subject: `Withdrawal ${w.reference}: ${w.order_text.slice(0, 80)}`,
      body: `A buyer used "Withdraw from contract here" on ${i18n.formatDate(w.created_at)}.

Order: ${w.order_text}
Name: ${w.name}
Email: ${w.email}
Language: ${w.lang}
${w.message ? `Message: ${w.message}\n` : ''}
${w.note}

They have been sent an acknowledgement. See Admin → Withdrawals: ${baseUrl}/admin/withdrawals`,
    };
  },
});

export function render(kind, data) {
  const template = templates[kind];
  if (!template) throw new Error(`Unknown email template: ${kind}`);
  const i18n = forLanguage(data.lang ?? data.p?.lang);
  const { subject, body } = template({ ...data, i18n });
  return { subject, body: body.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n') };
}
