import { db, now, parse } from './db.js';
import { newId, saveFile, prepareLogo } from './jobs.js';
import { STYLE_IDS } from './styles.js';
import { FORMAT_IDS } from './formats.js';

// A client's brand kit: everything the studio should reuse for every ad.
// Publishing tokens live in a separate table and never leave the server.

const HEX = /^#[0-9a-f]{6}$/i;
const LANGS = ['en', 'ru', 'et'];

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function getClient(id) {
  return parse(db.prepare('SELECT data FROM clients WHERE id = ?').get(id));
}

export function getSecrets(id) {
  return parse(db.prepare('SELECT data FROM client_secrets WHERE client_id = ?').get(id)) || {};
}

export function setSecrets(id, patch) {
  const next = { ...getSecrets(id), ...patch };
  db.prepare('INSERT INTO client_secrets (client_id, data) VALUES (?, ?) ON CONFLICT(client_id) DO UPDATE SET data = excluded.data')
    .run(id, JSON.stringify(next));
  return next;
}

// What the app may see about the connections: names, never tokens.
function connections(id) {
  const s = getSecrets(id);
  return {
    meta: s.meta ? { pageName: s.meta.pageName || null, igUsername: s.meta.igUsername || null, adAccountName: s.meta.adAccountName || null } : null,
    google: s.google ? { customerName: s.google.customerName || null, customerId: s.google.customerId || null } : null,
  };
}

export function publicClient(client) {
  return client ? { ...client, connections: connections(client.id) } : null;
}

export function listClients() {
  return db.prepare('SELECT data FROM clients ORDER BY json_extract(data, \'$.name\') COLLATE NOCASE').all().map((row) => publicClient(parse(row)));
}

/** Creates or updates a brand kit. `logo` may be a data URI, null (remove) or undefined (keep). */
export async function saveClient(id, input) {
  const existing = id ? getClient(id) : null;
  if (id && !existing) return null;
  const client = existing || { id: newId(6), createdAt: now() };
  const name = text(input.name, 60);
  if (!name) throw Object.assign(new Error('Name required'), { userMessage: 'Give the client a name.' });

  Object.assign(client, {
    name,
    primary: HEX.test(input.primary || '') ? input.primary : '',
    accent: HEX.test(input.accent || '') ? input.accent : '',
    style: input.style === 'auto' || STYLE_IDS.includes(input.style) ? input.style : 'auto',
    language: LANGS.includes(input.language) ? input.language : 'en',
    tone: text(input.tone, 300),
    website: text(input.website, 200),
    about: text(input.about, 600),
    formats: Array.isArray(input.formats) && input.formats.some((f) => FORMAT_IDS.includes(f))
      ? input.formats.filter((f) => FORMAT_IDS.includes(f))
      : ['post', 'story'],
    updatedAt: now(),
  });

  if (input.logo === null) client.logo = null;
  else if (typeof input.logo === 'string' && input.logo.startsWith('data:image/')) {
    const png = await prepareLogo(input.logo);
    client.logo = saveFile(`c-${client.id}`, `logo-${Date.now()}.png`, png);
  }

  db.prepare(`INSERT INTO clients (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
    .run(client.id, JSON.stringify(client), client.createdAt, client.updatedAt);
  return publicClient(client);
}

export function deleteClient(id) {
  db.prepare('DELETE FROM clients WHERE id = ?').run(id);
  db.prepare('DELETE FROM client_secrets WHERE client_id = ?').run(id);
}
