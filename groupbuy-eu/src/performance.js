import { CHANNELS, channelLabel, cleanTag, shopDay } from './analytics.js';
import { EU_COUNTRIES } from './util.js';

// The numbers behind Admin → Performance: visits (src/analytics.js), buyers and sales (the
// participants table) and the ad spend the owner typed in, for the last `days` days.

export const RANGES = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last 12 months' },
];

// Channels offered in the link maker and the ad spend form, in this order.
export const AD_CHANNELS = ['facebook', 'instagram', 'tiktok', 'google', 'whatsapp', 'telegram', 'messenger', 'viber', 'x', 'youtube', 'pinterest', 'snapchat', 'linkedin', 'email'];
// The "Type" of a tracked link -> utm_medium.
export const LINK_TYPES = [
  { medium: 'paid', label: 'Paid advert' },
  { medium: 'social', label: 'Free post' },
  { medium: 'message', label: 'Message, chat or group' },
  { medium: 'email', label: 'Email or newsletter' },
  { medium: 'influencer', label: 'Influencer or partner' },
];

const DAY_MS = 86_400_000;
const parseDay = (day) => Date.parse(`${day}T12:00:00Z`);
export const addDays = (day, n) => new Date(parseDay(day) + n * DAY_MS).toISOString().slice(0, 10);
export const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseDay(s)) && addDays(s, 0) === s;

function listDays(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
// The Monday of the day's week.
const weekOf = (day) => addDays(day, -((new Date(parseDay(day)).getUTCDay() + 6) % 7));

const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const labelOf = (day) => shortDate.format(new Date(parseDay(day)));
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });

// A buyer who saved a payment method (a withdrawn buyer counts if they had saved one).
const joined = (p) => p.status !== 'pending_setup' && (p.status !== 'withdrawn' || Boolean(p.payment_method_id));
const sum = (rows, f) => rows.reduce((n, r) => n + (Number(f(r)) || 0), 0);
const ratio = (a, b) => (b ? a / b : null);

function group(rows, keyOf) {
  const m = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

// Sales numbers for one group of buyers.
function salesOf(started = [], paid = []) {
  return {
    started: started.length,
    joined: started.filter(joined).length,
    paid: paid.length,
    revenueCents: sum(paid, (p) => p.amount_cents),
  };
}

function withRates(row) {
  return {
    ...row,
    conversion: ratio(row.joined, row.visitors),
    costPerBuyerCents: row.spendCents && row.joined ? Math.round(row.spendCents / row.joined) : null,
    roas: ratio(row.revenueCents, row.spendCents),
  };
}

export function buildReport(repo, { days = 30, now = new Date() } = {}) {
  const to = shopDay(now);
  const from = addDays(to, -(days - 1));
  const inRange = (iso) => {
    if (!iso) return false;
    const d = shopDay(iso);
    return d >= from && d <= to;
  };

  // Buyers: orders started in the range, and orders paid in the range (a day early is fetched
  // because the range is in the shop's time zone).
  const people = repo.participantsForReport(new Date(parseDay(from) - 2 * DAY_MS).toISOString());
  const started = people.filter((p) => inRange(p.created_at));
  const paid = people.filter((p) => p.status === 'paid' && inRange(p.paid_at));
  const spend = repo.adSpendBetween(from, to);

  // ---- per day (or per week for 12 months)
  const byWeek = days > 90;
  const bucketOf = (day) => (byWeek ? weekOf(day) : day);
  const buckets = new Map();
  for (const day of listDays(from, to)) {
    const key = bucketOf(day);
    if (!buckets.has(key)) buckets.set(key, { key, label: byWeek ? `Week of ${labelOf(key)}` : labelOf(key), visitors: 0, views: 0, joined: 0, revenueCents: 0 });
  }
  const visitsByDay = repo.visitsByDay(from, to);
  for (const v of visitsByDay) {
    const b = buckets.get(bucketOf(v.day));
    if (b) {
      b.visitors += v.visitors;
      b.views += v.views;
    }
  }
  for (const p of started.filter(joined)) {
    const b = buckets.get(bucketOf(shopDay(p.created_at)));
    if (b) b.joined += 1;
  }
  for (const p of paid) {
    const b = buckets.get(bucketOf(shopDay(p.paid_at)));
    if (b) b.revenueCents += p.amount_cents ?? 0;
  }
  const series = [...buckets.values()];

  // ---- totals
  const totals = withRates({
    views: sum(visitsByDay, (v) => v.views),
    visitors: sum(visitsByDay, (v) => v.visitors),
    visits: sum(visitsByDay, (v) => v.visits),
    ...salesOf(started, paid),
    vatCents: sum(paid, (p) => p.tax_cents),
    spendCents: sum(spend, (s) => s.amount_cents),
  });
  totals.averageOrderCents = totals.paid ? Math.round(totals.revenueCents / totals.paid) : null;

  // ---- where visitors and buyers came from
  const sourceKey = (p) => p.source || 'unknown';
  const startedBySource = group(started, sourceKey);
  const paidBySource = group(paid, sourceKey);
  const spendBySource = group(spend, (s) => s.source);
  const visitsBySource = new Map(repo.visitsBy('source', from, to, { entriesOnly: true }).map((r) => [r.source, r]));
  const sourceKeys = new Set([...visitsBySource.keys(), ...startedBySource.keys(), ...paidBySource.keys(), ...spendBySource.keys()]);
  const sources = [...sourceKeys]
    .map((source) =>
      withRates({
        source,
        label: source === 'unknown' ? 'Not known (joined before tracking started)' : channelLabel(source),
        visits: visitsBySource.get(source)?.visits ?? 0,
        visitors: visitsBySource.get(source)?.visitors ?? 0,
        ...salesOf(startedBySource.get(source), paidBySource.get(source)),
        spendCents: sum(spendBySource.get(source) ?? [], (s) => s.amount_cents),
      })
    )
    .sort((a, b) => b.visits - a.visits || b.joined - a.joined || b.spendCents - a.spendCents);

  // ---- campaigns (links with utm_campaign, and ad spend with a campaign name)
  const campaignKey = (r) => `${r.source}\n${r.campaign}`;
  const withCampaign = (rows) => rows.filter((r) => r.campaign);
  const startedByCampaign = group(withCampaign(started), campaignKey);
  const paidByCampaign = group(withCampaign(paid), campaignKey);
  const spendByCampaign = group(withCampaign(spend), campaignKey);
  const visitsByCampaign = new Map(repo.visitsBy('campaign', from, to, { entriesOnly: true }).map((r) => [campaignKey(r), r]));
  const campaignKeys = new Set([...visitsByCampaign.keys(), ...startedByCampaign.keys(), ...paidByCampaign.keys(), ...spendByCampaign.keys()]);
  const campaigns = [...campaignKeys]
    .map((key) => {
      const [source, campaign] = key.split('\n');
      return withRates({
        source,
        campaign,
        label: channelLabel(source),
        visits: visitsByCampaign.get(key)?.visits ?? 0,
        visitors: visitsByCampaign.get(key)?.visitors ?? 0,
        ...salesOf(startedByCampaign.get(key), paidByCampaign.get(key)),
        spendCents: sum(spendByCampaign.get(key) ?? [], (s) => s.amount_cents),
      });
    })
    .sort((a, b) => b.visits - a.visits || b.joined - a.joined);

  // ---- deals: the funnel from page view to payment
  const visitsByDeal = new Map(repo.visitsBy('deal', from, to).map((r) => [r.deal_id, r]));
  const startedByDeal = group(started, (p) => p.deal_id);
  const paidByDeal = group(paid, (p) => p.deal_id);
  const deals = repo
    .listDeals()
    .filter((d) => d.status === 'open' || visitsByDeal.has(d.id) || startedByDeal.has(d.id) || paidByDeal.has(d.id))
    .map((deal) => {
      const v = visitsByDeal.get(deal.id);
      return withRates({
        deal,
        committed: repo.committedCount(deal.id),
        views: v?.views ?? 0,
        visitors: v?.visitors ?? 0,
        ...salesOf(startedByDeal.get(deal.id), paidByDeal.get(deal.id)),
        spendCents: 0,
      });
    })
    .sort((a, b) => b.visitors - a.visitors || b.joined - a.joined);

  // ---- buyers' countries, languages and devices
  const paidByCountry = group(paid, (p) => p.country);
  const startedByCountry = group(started, (p) => p.country);
  const countries = [...new Set([...startedByCountry.keys(), ...paidByCountry.keys()])]
    .map((code) => ({ code, name: EU_COUNTRIES[code] ?? safeName(countryNames, code), ...salesOf(startedByCountry.get(code), paidByCountry.get(code)) }))
    .filter((c) => c.joined || c.paid)
    .sort((a, b) => b.revenueCents - a.revenueCents || b.joined - a.joined);

  const joinedByLang = group(started.filter(joined), (p) => p.lang || 'en');
  const visitorsByLang = new Map(repo.visitsBy('lang', from, to).map((r) => [r.lang || 'en', r.visitors]));
  const languages = [...new Set([...visitorsByLang.keys(), ...joinedByLang.keys()])]
    .map((code) => ({ code, name: safeName(languageNames, code), visitors: visitorsByLang.get(code) ?? 0, joined: joinedByLang.get(code)?.length ?? 0 }))
    .sort((a, b) => b.visitors - a.visitors || b.joined - a.joined);

  const devices = repo.visitsBy('device', from, to).map((r) => ({ device: r.device, visitors: r.visitors, share: ratio(r.visitors, totals.visitors) }));

  return {
    days,
    from,
    to,
    byWeek,
    series,
    totals,
    sources,
    campaigns,
    deals,
    countries,
    languages,
    devices,
    spend: spend.map((s) => ({ ...s, label: channelLabel(s.source) })),
    trackingSince: repo.firstVisitDay(),
  };
}

function safeName(names, code) {
  try {
    return names.of(code) || code;
  } catch {
    return code;
  }
}

// Ad spend form -> { errors, values } (values ready for repo.insertAdSpend).
export function validateAdSpend(body, now = new Date()) {
  const errors = {};
  const day = String(body.day ?? '').trim();
  const rawSource = cleanTag(body.source, 40);
  const source = rawSource === 'other' ? cleanTag(body.other_source, 40) : rawSource;
  const campaign = cleanTag(body.campaign);
  const amountText = String(body.amount ?? '').trim().replace(/\s|€/g, '').replace(',', '.');
  const amount = Number(amountText);
  if (!isDay(day)) errors.day = 'Pick the date of the spend.';
  else if (day > addDays(shopDay(now), 1)) errors.day = 'The date is in the future.';
  if (!source) errors.source = 'Choose where the advert ran.';
  if (!/^\d+(\.\d{1,2})?$/.test(amountText) || !(amount > 0) || amount > 1_000_000) errors.amount = 'Enter the amount in euros, for example 25 or 12.50.';
  const note = String(body.note ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
  return {
    errors,
    values: { day, source, campaign, amount_cents: Math.round(amount * 100), note, created_at: now.toISOString() },
    form: { day, source: rawSource, other_source: body.other_source ?? '', campaign: body.campaign ?? '', amount: body.amount ?? '', note },
  };
}

export const isKnownChannel = (s) => Object.hasOwn(CHANNELS, s);
