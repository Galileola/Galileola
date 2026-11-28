import { db, now } from './db.js';
import { getClient, getSecrets, setSecrets } from './clients.js';
import { newId, persist, readFile } from './jobs.js';
import { writeCaption } from './director.js';
import path from 'node:path';

// One-click publishing. Each client connects its own accounts once:
// - Facebook Page and Instagram (posts and stories), and a Meta ad account
//   (the ad goes into the account's media library, ready for a campaign)
// - Google Ads (the banner becomes an image asset in the account)
// Nothing here starts a paid campaign or spends money.

const META_VERSION = process.env.META_GRAPH_VERSION || 'v27.0';
const GRAPH = `${process.env.META_GRAPH_URL || 'https://graph.facebook.com'}/${META_VERSION}`;
const META_SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish', 'business_management', 'ads_management'];
const GADS = `${process.env.GOOGLE_ADS_URL || 'https://googleads.googleapis.com'}/${process.env.GOOGLE_ADS_API_VERSION || 'v25'}`;
const GOOGLE_TOKEN = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';

const fail = (message, userMessage) => Object.assign(new Error(message), { userMessage: userMessage || message });

export function publishingSetup() {
  return {
    meta: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  };
}

/** The server's public address: needed for sign-in redirects and for Meta to fetch the images. */
export function baseUrl(req) {
  return (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

// ---- Sign-in state (lives for an hour) ----

function newState(data) {
  const state = newId(18);
  db.prepare('INSERT INTO oauth_states (state, data, created_at) VALUES (?, ?, ?)').run(state, JSON.stringify(data), now());
  return state;
}

function readState(state, provider) {
  const row = db.prepare('SELECT data, created_at FROM oauth_states WHERE state = ?').get(String(state || ''));
  if (!row || Date.now() - Date.parse(row.created_at) > 3600 * 1000) throw fail('Sign-in expired', 'This sign-in link has expired. Start again from the app.');
  const data = JSON.parse(row.data);
  if (data.provider !== provider) throw fail('Wrong provider', 'This sign-in link is not valid.');
  return data;
}

function writeState(state, data) {
  db.prepare('UPDATE oauth_states SET data = ? WHERE state = ?').run(JSON.stringify(data), state);
}

function dropState(state) {
  db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
}

// ---- Meta (Facebook, Instagram, Meta ads) ----

async function graph(endpoint, { method = 'GET', params = {} } = {}) {
  const url = new URL(`${GRAPH}${endpoint}`);
  const init = { method, signal: AbortSignal.timeout(60_000) };
  if (method === 'GET') for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  else init.body = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error || {};
    throw fail(`Meta ${res.status}: ${e.message || 'error'}`, `Facebook says: ${e.error_user_msg || e.message || 'the request failed'}`);
  }
  return data;
}

export function metaConnectUrl(clientId, base) {
  if (!publishingSetup().meta) throw fail('Meta not set up', 'Facebook and Instagram publishing isn’t set up on the server yet (META_APP_ID and META_APP_SECRET).');
  const state = newState({ provider: 'meta', clientId, base });
  const url = new URL(`https://www.facebook.com/${META_VERSION}/dialog/oauth`);
  url.searchParams.set('client_id', process.env.META_APP_ID);
  url.searchParams.set('redirect_uri', `${base}/connect/meta/callback`);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', META_SCOPES.join(','));
  url.searchParams.set('response_type', 'code');
  return url.toString();
}

/** After Facebook sign-in: swaps the code for a long-lived token and lists Pages and ad accounts. */
export async function metaCallback({ code, state }) {
  const st = readState(state, 'meta');
  const auth = { client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET };
  const short = await graph('/oauth/access_token', { params: { ...auth, redirect_uri: `${st.base}/connect/meta/callback`, code } });
  const long = await graph('/oauth/access_token', { params: { ...auth, grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token } });
  const userToken = long.access_token;
  const pages = await graph('/me/accounts', { params: { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: 100, access_token: userToken } });
  const ads = await graph('/me/adaccounts', { params: { fields: 'account_id,name', limit: 100, access_token: userToken } }).catch(() => ({ data: [] }));
  writeState(state, { ...st, userToken, userTokenExpires: long.expires_in ? Date.now() + long.expires_in * 1000 : null, pages: pages.data || [], adAccounts: ads.data || [] });
  return {
    clientName: getClient(st.clientId)?.name || '',
    pages: (pages.data || []).map((p) => ({ id: p.id, name: p.name, instagram: p.instagram_business_account?.username || null })),
    adAccounts: (ads.data || []).map((a) => ({ id: a.account_id, name: a.name })),
  };
}

/** Saves the chosen Page (with its Instagram account) and ad account for the client. */
export function metaFinish({ state, pageId, adAccountId }) {
  const st = readState(state, 'meta');
  const page = (st.pages || []).find((p) => p.id === pageId);
  const ad = (st.adAccounts || []).find((a) => a.account_id === adAccountId);
  if (!page && !ad) throw fail('Nothing chosen', 'Choose a Facebook Page or an ad account.');
  setSecrets(st.clientId, {
    meta: {
      pageId: page?.id || null,
      pageName: page?.name || null,
      pageToken: page?.access_token || null,
      igUserId: page?.instagram_business_account?.id || null,
      igUsername: page?.instagram_business_account?.username || null,
      adAccountId: ad?.account_id || null,
      adAccountName: ad?.name || null,
      userToken: st.userToken,
      userTokenExpires: st.userTokenExpires,
    },
  });
  dropState(state);
  return getClient(st.clientId)?.name || '';
}

async function publishMetaPage(meta, { kind, url, text }) {
  if (!meta?.pageId) throw fail('No page', 'Connect a Facebook Page for this client first.');
  const result = kind === 'video'
    ? await graph(`/${meta.pageId}/videos`, { method: 'POST', params: { file_url: url, description: text, access_token: meta.pageToken } })
    : await graph(`/${meta.pageId}/photos`, { method: 'POST', params: { url, caption: text, access_token: meta.pageToken } });
  const id = result.post_id || result.id;
  return { id, link: id ? `https://www.facebook.com/${id}` : null };
}

async function publishInstagram(meta, { kind, url, text, story }) {
  if (!meta?.igUserId) throw fail('No Instagram', 'This client’s Facebook Page has no Instagram business account connected.');
  const params = { access_token: meta.pageToken };
  if (kind === 'video') Object.assign(params, { video_url: url, media_type: story ? 'STORIES' : 'REELS' });
  else Object.assign(params, { image_url: url, ...(story ? { media_type: 'STORIES' } : {}) });
  if (!story) params.caption = text;
  const container = await graph(`/${meta.igUserId}/media`, { method: 'POST', params });
  // Instagram prepares the media first; videos can take a minute.
  for (let i = 0; i < 60; i++) {
    const { status_code: status } = await graph(`/${container.id}`, { params: { fields: 'status_code', access_token: meta.pageToken } });
    if (status === 'FINISHED') break;
    if (status === 'ERROR' || status === 'EXPIRED') throw fail(`Instagram ${status}`, 'Instagram could not process this file.');
    await new Promise((r) => setTimeout(r, 3000));
  }
  const published = await graph(`/${meta.igUserId}/media_publish`, { method: 'POST', params: { creation_id: container.id, access_token: meta.pageToken } });
  return { id: published.id, link: null };
}

async function publishMetaAds(meta, { kind, url, file, name }) {
  if (!meta?.adAccountId) throw fail('No ad account', 'Connect a Meta ad account for this client first.');
  const account = `/act_${meta.adAccountId}`;
  if (kind === 'video') {
    const v = await graph(`${account}/advideos`, { method: 'POST', params: { file_url: url, name, access_token: meta.userToken } });
    return { id: v.id, link: null };
  }
  const r = await graph(`${account}/adimages`, { method: 'POST', params: { bytes: file.toString('base64'), name, access_token: meta.userToken } });
  const image = Object.values(r.images || {})[0];
  return { id: image?.hash || null, link: null };
}

// ---- Google Ads ----

async function googleToken(params) {
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, ...params }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw fail(`Google token ${res.status}: ${data.error_description || data.error}`, 'Google sign-in failed. Connect Google Ads again.');
  return data;
}

async function gads(endpoint, { token, method = 'GET', body, loginCustomerId } = {}) {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;
  if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) headers['developer-token'] = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const res = await fetch(`${GADS}${endpoint}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    throw fail(`Google Ads ${res.status}: ${msg}`, `Google Ads says: ${msg}`);
  }
  return data;
}

export function googleConnectUrl(clientId, base) {
  if (!publishingSetup().google) throw fail('Google not set up', 'Google Ads publishing isn’t set up on the server yet (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).');
  const state = newState({ provider: 'google', clientId, base });
  const url = new URL(GOOGLE_AUTH);
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', `${base}/connect/google/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'https://www.googleapis.com/auth/adwords');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return url.toString();
}

/** After Google sign-in: keeps the refresh token and lists the Google Ads accounts. */
export async function googleCallback({ code, state }) {
  const st = readState(state, 'google');
  const tokens = await googleToken({ code, redirect_uri: `${st.base}/connect/google/callback`, grant_type: 'authorization_code' });
  if (!tokens.refresh_token) throw fail('No refresh token', 'Google didn’t give long-term access. Remove Ad Studio under your Google account’s third-party access and connect again.');
  const list = await gads('/customers:listAccessibleCustomers', { token: tokens.access_token }).catch(() => ({ resourceNames: [] }));
  const customers = [];
  for (const name of (list.resourceNames || []).slice(0, 25)) {
    const id = name.split('/')[1];
    const r = await gads(`/customers/${id}/googleAds:search`, {
      token: tokens.access_token, method: 'POST', body: { query: 'SELECT customer.id, customer.descriptive_name, customer.manager FROM customer LIMIT 1' },
    }).catch(() => null);
    const c = r?.results?.[0]?.customer;
    customers.push({ id, name: c?.descriptiveName || id, manager: Boolean(c?.manager) });
  }
  writeState(state, { ...st, refreshToken: tokens.refresh_token, customers });
  return { clientName: getClient(st.clientId)?.name || '', customers };
}

export function googleFinish({ state, customerId, loginCustomerId }) {
  const st = readState(state, 'google');
  const id = String(customerId || '').replace(/\D/g, '');
  if (!id) throw fail('No account', 'Choose or type a Google Ads account ID.');
  const known = (st.customers || []).find((c) => c.id === id);
  setSecrets(st.clientId, {
    google: { refreshToken: st.refreshToken, customerId: id, customerName: known?.name || id, loginCustomerId: String(loginCustomerId || '').replace(/\D/g, '') || null },
  });
  dropState(state);
  return getClient(st.clientId)?.name || '';
}

async function publishGoogleAds(google, { kind, file, name }) {
  if (!google?.customerId) throw fail('No Google Ads', 'Connect Google Ads for this client first.');
  if (kind === 'video') throw fail('Video not supported', 'Google Ads takes videos from YouTube; upload the video there and add it in Google Ads.');
  const { access_token: token } = await googleToken({ refresh_token: google.refreshToken, grant_type: 'refresh_token' });
  const r = await gads(`/customers/${google.customerId}/assets:mutate`, {
    token, method: 'POST', loginCustomerId: google.loginCustomerId,
    body: { operations: [{ create: { name, type: 'IMAGE', imageAsset: { data: file.toString('base64') } } }] },
  });
  return { id: r.results?.[0]?.resourceName || null, link: null };
}

export function disconnect(clientId, provider) {
  setSecrets(clientId, { [provider]: null });
}

// ---- Publishing an ad ----

export const TARGETS = ['facebook', 'instagram', 'meta_ads', 'google_ads'];

/** Suggested post text for the client's social accounts. */
export async function suggestCaption(job) {
  const c = await writeCaption({ brief: job.brief, request: job.request, platform: 'Facebook and Instagram' });
  return `${c.caption}\n\n${c.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}`.trim();
}

/**
 * Starts publishing one finished banner or video to the chosen places.
 * what: { format, kind: 'image' | 'video' | 'presenter', targets, caption }.
 * Checks right away and throws if it can't start; the publishing itself
 * runs in the background (an Instagram video can take minutes) and its
 * results appear in job.publishRuns[runId] and job.published.
 */
export function startPublish(job, { format, kind, targets, caption }, base) {
  if (!job.clientId) throw fail('No client', 'Publishing works for ads made for a saved client. Choose a client when you create the ad.');
  let mediaPath;
  if (kind === 'presenter') mediaPath = job.avatar?.status === 'done' ? job.avatar.url : null;
  else if (kind === 'video') mediaPath = job.videos?.[format]?.status === 'done' ? job.videos[format].url : null;
  else mediaPath = job.formats[format]?.stage === 'done' ? job.formats[format].banner : null;
  if (!mediaPath) throw fail('Nothing to publish', 'This ad isn’t finished yet.');

  const runId = newId(6);
  const run = { status: 'working', format, kind, targets, startedAt: now(), results: [] };
  job.publishRuns = { ...(job.publishRuns || {}), [runId]: run };
  persist(job);

  (async () => {
    const secrets = getSecrets(job.clientId);
    const mediaKind = kind === 'image' ? 'image' : 'video';
    const url = `${base}${mediaPath}`;
    const name = `${job.request.brand || 'Ad'} – ${job.brief?.copy?.headline || ''} (${format})`.slice(0, 120);
    const file = mediaKind === 'image' ? readFile(job.id, path.basename(mediaPath)) : null;
    const story = format === 'story' || kind === 'presenter';
    const text = caption || '';
    for (const target of targets) {
      try {
        let r;
        if (target === 'facebook') r = await publishMetaPage(secrets.meta, { kind: mediaKind, url, text });
        else if (target === 'instagram') r = await publishInstagram(secrets.meta, { kind: mediaKind, url, text, story });
        else if (target === 'meta_ads') r = await publishMetaAds(secrets.meta, { kind: mediaKind, url, file, name });
        else if (target === 'google_ads') r = await publishGoogleAds(secrets.google, { kind: mediaKind, file, name });
        else continue;
        run.results.push({ target, ok: true, ...r });
      } catch (err) {
        console.error(`[${job.id}] publish to ${target} failed:`, err.message);
        run.results.push({ target, ok: false, error: err.userMessage || 'Publishing failed.' });
      }
      persist(job);
    }
    run.status = 'done';
    job.published = [...(job.published || []), ...run.results.map((r) => ({ ...r, format, kind, at: now() }))];
    persist(job);
  })();
  return runId;
}
