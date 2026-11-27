// Talks to the Ad Studio server. The server holds the AI keys; the app
// never does. APP_TOKEN only stops strangers from using your server.

// On the web, when the server itself serves the app, the API is on the same address.
const sameOrigin = typeof window !== 'undefined' && window.location?.protocol?.startsWith('http') && !process.env.EXPO_PUBLIC_API_URL && !/:(8081|19006)$/.test(window.location.host)
  ? window.location.origin
  : '';

let config = {
  url: process.env.EXPO_PUBLIC_API_URL || sameOrigin,
  token: process.env.EXPO_PUBLIC_APP_TOKEN || '',
};

export function setServer(next) {
  config = { ...config, ...next };
}

export function getServer() {
  return config;
}

function base() {
  return config.url.trim().replace(/\/+$/, '');
}

export function fileUrl(path) {
  return path ? `${base()}${path}` : null;
}

async function call(path, { method = 'GET', body } = {}) {
  if (!base()) throw new Error('Add your server address in Settings first.');
  let res;
  try {
    res = await fetch(`${base()}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(config.token ? { 'x-app-token': config.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Can’t reach the server. Check the address in Settings and your internet connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
  return data;
}

export const api = {
  health: () => call('/health'),
  options: () => call('/api/options'),

  clients: () => call('/api/clients'),
  client: (id) => call(`/api/clients/${id}`),
  saveClient: (id, body) => call(id ? `/api/clients/${id}` : '/api/clients', { method: id ? 'PUT' : 'POST', body }),
  deleteClient: (id) => call(`/api/clients/${id}`, { method: 'DELETE' }),
  connect: (id, provider) => call(`/api/clients/${id}/connect/${provider}`, { method: 'POST' }),
  disconnect: (id, provider) => call(`/api/clients/${id}/connect/${provider}`, { method: 'DELETE' }),

  createJob: (body) => call('/api/jobs', { method: 'POST', body }),
  jobs: (clientId, limit = 20) => call(`/api/jobs?limit=${limit}${clientId ? `&client=${clientId}` : ''}`),
  job: (id) => call(`/api/jobs/${id}`),
  editText: (id, copy, style) => call(`/api/jobs/${id}/text`, { method: 'POST', body: { copy, style } }),
  redo: (id, format) => call(`/api/jobs/${id}/redo`, { method: 'POST', body: { format } }),
  video: (id, format) => call(`/api/jobs/${id}/video`, { method: 'POST', body: { format } }),
  avatar: (id, body) => call(`/api/jobs/${id}/avatar`, { method: 'POST', body }),
  review: (id) => call(`/api/jobs/${id}/review`, { method: 'POST' }),
  jobSlogans: (id) => call(`/api/jobs/${id}/slogans`, { method: 'POST' }),
  caption: (id) => call(`/api/jobs/${id}/caption`, { method: 'POST' }),
  publish: (id, body) => call(`/api/jobs/${id}/publish`, { method: 'POST', body }),

  slogans: (body) => call('/api/slogans', { method: 'POST', body }),
  shopProducts: (body) => call('/api/shop/products', { method: 'POST', body }),
  startBatch: (body) => call('/api/batches', { method: 'POST', body }),
  batches: () => call('/api/batches'),
  batch: (id) => call(`/api/batches/${id}`),
};

export const TARGETS = [
  { id: 'facebook', label: 'Facebook Page', needs: 'meta', check: (c) => c?.meta?.pageName },
  { id: 'instagram', label: 'Instagram', needs: 'meta', check: (c) => c?.meta?.igUsername },
  { id: 'meta_ads', label: 'Meta ads library', needs: 'meta', check: (c) => c?.meta?.adAccountName },
  { id: 'google_ads', label: 'Google Ads assets', needs: 'google', check: (c) => c?.google?.customerId, imagesOnly: true },
];

export const FORMATS = [
  { id: 'post', label: 'Post 1:1', hint: 'Instagram, Facebook', ratio: 1 },
  { id: 'story', label: 'Story 9:16', hint: 'Stories, Reels, TikTok', ratio: 1080 / 1920 },
  { id: 'wide', label: 'Banner 1.91:1', hint: 'Facebook ads, websites', ratio: 1200 / 628 },
];

export const STYLES = [
  { id: 'auto', label: 'Auto' },
  { id: 'luxury', label: 'Luxury' },
  { id: 'bold', label: 'Bold' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'fresh', label: 'Fresh' },
  { id: 'tech', label: 'Tech' },
  { id: 'warm', label: 'Warm' },
];

export const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'ru', label: 'Русский' },
  { id: 'et', label: 'Eesti' },
];
