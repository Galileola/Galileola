import { render } from './emails.js';
import { isValidEmail, randomToken } from './util.js';
import { currentBrand } from './branding.js';

// Deal alerts: shoppers leave their email address to hear about new deals. Double opt-in: nothing
// is sent until they confirm with the link in the first email (proof of consent, GDPR Art. 7).
// Every alert has an unsubscribe link and the one-click unsubscribe headers mail apps show.

const RESEND_AFTER_MS = 10 * 60_000;
export const UNCONFIRMED_DAYS = 30;

const links = (config, sub) => ({
  unsubscribe: `${config.baseUrl}/alerts/unsubscribe/${sub.token}`,
});

async function sendConfirm(ctx, sub) {
  const { config, mailer, clock } = ctx;
  const { subject, body } = render('alertConfirm', {
    sub, lang: sub.lang, shop: currentBrand(config).name, baseUrl: config.baseUrl, business: config.business,
  });
  await mailer.send({ kind: 'alertConfirm', to: sub.email, subject, body });
  ctx.repo.updateSubscriber(sub.id, { confirm_sent_at: clock.now().toISOString() });
}

// A sign-up from the shop. Always answers the same way ("check your inbox"), so the form doesn't
// reveal who is subscribed. Returns 'invalid' for a bad address, else 'ok'.
export async function subscribe(ctx, { email, lang }) {
  const { repo, clock } = ctx;
  const address = String(email ?? '').trim().toLowerCase();
  if (!isValidEmail(address)) return 'invalid';
  const now = clock.now();
  let sub = repo.subscriberByEmail(address);
  if (!sub) {
    sub = repo.insertSubscriber({ email: address, lang, token: randomToken(24), created_at: now.toISOString() });
    await sendConfirm(ctx, sub);
    return 'ok';
  }
  if (sub.status === 'confirmed') return 'ok';
  if (sub.status === 'unsubscribed') {
    repo.updateSubscriber(sub.id, { status: 'pending', lang, token: randomToken(24), unsubscribed_at: null, created_at: now.toISOString() });
    await sendConfirm(ctx, repo.subscriberByEmail(address));
    return 'ok';
  }
  // Still pending: send the confirmation again, but not more than every 10 minutes.
  if (!sub.confirm_sent_at || now - new Date(sub.confirm_sent_at) > RESEND_AFTER_MS) {
    repo.updateSubscriber(sub.id, { lang });
    await sendConfirm(ctx, { ...sub, lang });
  }
  return 'ok';
}

export function confirm(ctx, token) {
  const sub = token ? ctx.repo.subscriberByToken(token) : null;
  if (!sub || sub.status === 'unsubscribed') return null;
  if (sub.status === 'pending') ctx.repo.updateSubscriber(sub.id, { status: 'confirmed', confirmed_at: ctx.clock.now().toISOString() });
  return ctx.repo.subscriberByToken(token);
}

export function unsubscribe(ctx, token) {
  const sub = token ? ctx.repo.subscriberByToken(token) : null;
  if (!sub) return null;
  if (sub.status !== 'unsubscribed') ctx.repo.updateSubscriber(sub.id, { status: 'unsubscribed', unsubscribed_at: ctx.clock.now().toISOString() });
  return sub;
}

// Emails a deal to every confirmed subscriber, in their language (the deal's translated name and
// headline when available). Returns the number of emails sent.
export async function announceDeal(ctx, deal) {
  const { repo, config, mailer, clock } = ctx;
  const subs = repo.subscribers('confirmed');
  for (const sub of subs) {
    const shown = ctx.translator ? ctx.translator.deal(deal, sub.lang) : deal;
    const { subject, body } = render('newDeal', { sub, deal: shown, lang: sub.lang, baseUrl: config.baseUrl, business: config.business });
    const unsubscribe = links(config, sub).unsubscribe;
    await mailer.send({
      kind: 'newDeal',
      to: sub.email,
      subject,
      body,
      dealId: deal.id,
      headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
  }
  repo.updateDeal(deal.id, { announced_at: clock.now().toISOString() });
  return subs.length;
}
