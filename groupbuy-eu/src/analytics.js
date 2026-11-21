import crypto from 'node:crypto';
import { systemClock } from './util.js';

// Visit statistics for Admin → Performance, kept in the shop's own database.
//
// No cookies and nothing else is stored on the visitor's device, and IP addresses are not kept.
// A visitor is counted with a fingerprint of their IP address and browser, made with a random key
// that is replaced every day (the old key is deleted), so the same person can't be recognised
// from one day to the next and a fingerprint can't be turned back into an address. That is the
// approach of the privacy-friendly analytics tools that work without a consent banner.
//
// For each page view: the page, the deal, where the visit came from (an ad link's utm_* tags,
// a click id such as fbclid or gclid, or the website that linked here), the shop language and
// the device type. When a visitor joins a deal the same day, the source of their visit is saved
// with their order, so the dashboard can show which ads and posts brought buyers.

export const KEEP_DAYS = 400; // about 13 months, then visits are deleted
const SALT_KEY = 'analytics-salt';
const SHOP_TIME_ZONE = 'Europe/Brussels';

const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
// 'YYYY-MM-DD' in the shop's time zone.
export const shopDay = (date) => dayFormatter.format(new Date(date));

// The channels the dashboard knows by name. `kind` decides the medium when a link has no
// utm_medium: social, search, message or email.
export const CHANNELS = {
  direct: { label: 'Direct (typed in, bookmark, app)', kind: '' },
  facebook: { label: 'Facebook', kind: 'social' },
  instagram: { label: 'Instagram', kind: 'social' },
  tiktok: { label: 'TikTok', kind: 'social' },
  google: { label: 'Google', kind: 'search' },
  whatsapp: { label: 'WhatsApp', kind: 'message' },
  telegram: { label: 'Telegram', kind: 'message' },
  messenger: { label: 'Messenger', kind: 'message' },
  viber: { label: 'Viber', kind: 'message' },
  x: { label: 'X (Twitter)', kind: 'social' },
  youtube: { label: 'YouTube', kind: 'social' },
  pinterest: { label: 'Pinterest', kind: 'social' },
  linkedin: { label: 'LinkedIn', kind: 'social' },
  reddit: { label: 'Reddit', kind: 'social' },
  snapchat: { label: 'Snapchat', kind: 'social' },
  vk: { label: 'VK', kind: 'social' },
  bing: { label: 'Bing', kind: 'search' },
  duckduckgo: { label: 'DuckDuckGo', kind: 'search' },
  ecosia: { label: 'Ecosia', kind: 'search' },
  yahoo: { label: 'Yahoo', kind: 'search' },
  yandex: { label: 'Yandex', kind: 'search' },
  seznam: { label: 'Seznam', kind: 'search' },
  qwant: { label: 'Qwant', kind: 'search' },
  email: { label: 'Email / newsletter', kind: 'email' },
  link: { label: 'Shared link (copied)', kind: 'message' },
};
export const channelLabel = (source) => CHANNELS[source]?.label ?? source;

// Referring website -> channel. The first match wins (webmail before google).
const REFERRERS = [
  [/(^|\.)(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|mail\.yahoo\.com|mail\.proton\.me|webmail\.)/, 'email'],
  [/^com\.google\.android\.gm$/, 'email'], // the Gmail app (android-app://com.google.android.gm)
  [/(^|\.)(messenger\.com)$/, 'messenger'],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|com\.facebook\.katana)$/, 'facebook'],
  [/(^|\.)(instagram\.com|com\.instagram\.android)$/, 'instagram'],
  [/(^|\.)(tiktok\.com|com\.zhiliaoapp\.musically)$/, 'tiktok'],
  [/(^|\.)(whatsapp\.com|wa\.me|com\.whatsapp)$/, 'whatsapp'],
  [/(^|\.)(t\.me|telegram\.org|telegram\.me|org\.telegram\.messenger)$/, 'telegram'],
  [/(^|\.)(viber\.com|com\.viber\.voip)$/, 'viber'],
  [/^(t\.co|twitter\.com|x\.com|mobile\.twitter\.com)$/, 'x'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)pinterest\.[a-z.]+$|^pin\.it$/, 'pinterest'],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, 'linkedin'],
  [/(^|\.)reddit\.com$/, 'reddit'],
  [/(^|\.)snapchat\.com$/, 'snapchat'],
  [/(^|\.)vk\.(com|ru)$/, 'vk'],
  [/(^|\.)(google\.[a-z.]+|googleadservices\.com|com\.google\.android\.googlequicksearchbox)$/, 'google'],
  [/(^|\.)bing\.com$/, 'bing'],
  [/(^|\.)duckduckgo\.com$/, 'duckduckgo'],
  [/(^|\.)ecosia\.org$/, 'ecosia'],
  [/(^|\.)yahoo\.[a-z.]+$/, 'yahoo'],
  [/(^|\.)yandex\.[a-z.]+$/, 'yandex'],
  [/(^|\.)seznam\.cz$/, 'seznam'],
  [/(^|\.)qwant\.com$/, 'qwant'],
];

// What people type into utm_source -> the channel's own name.
const SOURCE_ALIASES = {
  fb: 'facebook', 'facebook.com': 'facebook', meta: 'facebook', ig: 'instagram', insta: 'instagram',
  'instagram.com': 'instagram', tt: 'tiktok', 'tiktok.com': 'tiktok', wa: 'whatsapp', 'whats-app': 'whatsapp',
  twitter: 'x', 'x.com': 'x', tg: 'telegram', yt: 'youtube', adwords: 'google', 'google-ads': 'google',
  google_ads: 'google', googleads: 'google', gads: 'google', newsletter: 'email', mail: 'email', 'e-mail': 'email',
};

// Click ids that ad platforms add to their links: they say where a visit came from even
// without utm tags.
const CLICK_IDS = [
  ['gclid', 'google', 'cpc'], ['gbraid', 'google', 'cpc'], ['wbraid', 'google', 'cpc'], ['gad_source', 'google', 'cpc'],
  ['msclkid', 'bing', 'cpc'], ['ttclid', 'tiktok', 'cpc'], ['li_fat_id', 'linkedin', 'cpc'],
  ['fbclid', 'facebook', 'social'], ['igshid', 'instagram', 'social'],
];
export const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', ...CLICK_IDS.map(([p]) => p)];

// A tag value as stored: lower case, letters, digits and . _ - only.
export const cleanTag = (v, max = 60) =>
  String(v ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, max);

const firstValue = (v) => (Array.isArray(v) ? v[0] : v);

function hostOf(url) {
  try {
    const u = new URL(url);
    // android-app://com.google.android.gm/ has the app's id as its host.
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

// { entry, source, medium, campaign, referrer } for a page request. entry is false for a click
// from one page of the shop to another (those aren't new visits and have no source).
export function visitSource({ query = {}, referer = '', ownHosts = [] }) {
  const refHost = hostOf(referer);
  const utmSource = cleanTag(firstValue(query.utm_source), 40);
  const utmMedium = cleanTag(firstValue(query.utm_medium), 40);
  const campaign = cleanTag(firstValue(query.utm_campaign));
  const own = refHost && ownHosts.includes(refHost);
  const click = CLICK_IDS.find(([p]) => firstValue(query[p]));

  if (utmSource) {
    const source = SOURCE_ALIASES[utmSource] ?? utmSource;
    return { entry: true, source, medium: utmMedium || CHANNELS[source]?.kind || 'referral', campaign, referrer: own ? '' : refHost };
  }
  if (click) return { entry: true, source: click[1], medium: utmMedium || click[2], campaign, referrer: own ? '' : refHost };
  if (own) return { entry: false, source: '', medium: '', campaign: '', referrer: '' };
  if (!refHost) return { entry: true, source: 'direct', medium: '', campaign, referrer: '' };
  const match = REFERRERS.find(([re]) => re.test(refHost));
  const source = match ? match[1] : refHost;
  const kind = CHANNELS[source]?.kind;
  return { entry: true, source, medium: utmMedium || (kind === 'search' ? 'organic' : kind) || 'referral', campaign, referrer: refHost };
}

// Link-preview fetchers (WhatsApp, Facebook, Slack …), search engines, monitors and scripts
// aren't visitors.
const BOT_UA =
  /bot\b|bot\/|crawl|spider|slurp|preview|externalhit|externalagent|externalfetcher|facebot|^whatsapp\/|embedly|quora link|vkshare|w3c_validator|lighthouse|pagespeed|headless|phantomjs|adsbot|mediapartners|google-inspectiontool|google-read-aloud|apis-google|feedfetcher|python|curl|wget|java\/|go-http|okhttp|axios|node-fetch|undici|monitor|uptime|pingdom|scanner|slack-imgproxy|bitlybot|ia_archiver/i;
export const isBot = (ua) => !ua || !/mozilla\/|opera/i.test(ua) || BOT_UA.test(ua);

export function deviceType(ua = '') {
  if (/ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/i.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile|windows phone/i.test(ua)) return 'phone';
  return 'computer';
}

// Pages that count as visits: the home page, deal pages and the legal pages. Pages with a
// buyer's private link (/join/…, /pay/…) and the admin are never recorded.
export function trackedPath(p) {
  if (p === '/' || p === '/terms' || p === '/privacy' || p === '/cookies') return p;
  if (/^\/deals\/[a-z0-9][a-z0-9-]{0,100}$/.test(p)) return p;
  return null;
}

export function createAnalytics({ repo, clock = systemClock, config = {} }) {
  const ownHosts = new Set();
  try {
    if (config.baseUrl) ownHosts.add(new URL(config.baseUrl).hostname.toLowerCase().replace(/^www\./, ''));
  } catch {
    /* no base URL */
  }
  let salt = null; // { day, value }

  // Today's key. A new day gets a new random key and the old one is deleted, together with
  // visits older than KEEP_DAYS.
  function todaysSalt(day) {
    if (salt?.day === day) return salt.value;
    let saved = null;
    try {
      saved = JSON.parse(repo.getAdminSetting(SALT_KEY)?.value || 'null');
    } catch {
      saved = null;
    }
    if (saved?.day !== day || typeof saved.value !== 'string') {
      saved = { day, value: crypto.randomBytes(32).toString('base64url') };
      repo.setAdminSetting(SALT_KEY, JSON.stringify(saved), clock.now().toISOString());
      const cutoff = shopDay(clock.now().getTime() - KEEP_DAYS * 86_400_000);
      repo.deleteVisitsBefore(cutoff);
    }
    salt = saved;
    return salt.value;
  }

  function visitor(req, day) {
    const key = todaysSalt(day);
    return crypto
      .createHash('sha256')
      .update(`${key}\n${req.ip ?? ''}\n${req.get('user-agent') ?? ''}`)
      .digest('base64url')
      .slice(0, 22);
  }

  return {
    // Records one page view (called once the page has been sent).
    recordView(req, { path, dealId = null, lang = '' }) {
      const ua = req.get('user-agent') ?? '';
      if (isBot(ua)) return false;
      const purpose = `${req.get('sec-purpose') ?? ''} ${req.get('purpose') ?? ''} ${req.get('x-moz') ?? ''}`;
      if (/prefetch|prerender/i.test(purpose)) return false;
      const hosts = [...ownHosts, (req.hostname ?? '').toLowerCase().replace(/^www\./, '')].filter(Boolean);
      const src = visitSource({ query: req.query ?? {}, referer: req.get('referer') ?? '', ownHosts: hosts });
      const now = clock.now();
      const day = shopDay(now);
      repo.insertVisit({
        day,
        created_at: now.toISOString(),
        path,
        deal_id: dealId,
        visitor: visitor(req, day),
        entry: src.entry ? 1 : 0,
        source: src.source,
        medium: src.medium,
        campaign: src.campaign,
        referrer: src.referrer,
        lang: lang || '',
        device: deviceType(ua),
      });
      return true;
    },

    // Where today's visit of this visitor came from: the last source that wasn't "direct", else
    // direct. Saved with their order when they join a deal.
    sourceOf(req) {
      const day = shopDay(clock.now());
      const row = repo.lastVisitSource(day, visitor(req, day));
      return row ? { source: row.source, medium: row.medium, campaign: row.campaign } : { source: 'direct', medium: '', campaign: '' };
    },
  };
}

// Records page views of tracked pages after they've been sent with status 200. Routes can set
// res.locals.trackDealId so a deal page counts for its deal.
export function analyticsMiddleware(ctx) {
  return (req, res, next) => {
    if (req.method !== 'GET' || !ctx.analytics) return next();
    const page = trackedPath(req.path);
    if (!page) return next();
    res.on('finish', () => {
      if (res.statusCode !== 200) return;
      try {
        ctx.analytics.recordView(req, { path: page, dealId: res.locals.trackDealId ?? null, lang: res.locals.lang });
      } catch (err) {
        console.warn(`[analytics] could not record a visit: ${err.message}`);
      }
    });
    next();
  };
}
