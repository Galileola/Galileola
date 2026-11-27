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
  createJob: (body) => call('/api/jobs', { method: 'POST', body }),
  job: (id) => call(`/api/jobs/${id}`),
  editText: (id, copy, style) => call(`/api/jobs/${id}/text`, { method: 'POST', body: { copy, style } }),
  redo: (id, format) => call(`/api/jobs/${id}/redo`, { method: 'POST', body: { format } }),
  video: (id, format) => call(`/api/jobs/${id}/video`, { method: 'POST', body: { format } }),
};

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
