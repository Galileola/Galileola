import dns from 'node:dns/promises';
import net from 'node:net';

// Downloads from addresses that users type in (shops, product images).
// Refuses the server's own network, so nobody can use the studio to reach
// internal services. ALLOW_PRIVATE_FETCH=1 lifts that for local testing.

function privateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateAddress(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function checkUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw Object.assign(new Error('Bad URL'), { userMessage: 'That address doesn’t look right.' });
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw Object.assign(new Error('Bad protocol'), { userMessage: 'Use an http or https address.' });
  if (process.env.ALLOW_PRIVATE_FETCH !== '1') {
    const addresses = await dns.lookup(url.hostname, { all: true }).catch(() => []);
    if (!addresses.length) throw Object.assign(new Error('DNS failed'), { userMessage: `Can’t find ${url.hostname}.` });
    if (addresses.some((a) => privateAddress(a.address))) throw Object.assign(new Error('Private address'), { userMessage: 'That address can’t be used.' });
  }
  return url;
}

/** Fetches a public URL with a time limit and a size limit (bytes). */
export async function safeFetch(raw, { maxBytes = 15_000_000, timeoutMs = 20_000, accept } = {}) {
  let url = await checkUrl(raw);
  // Follow redirects by hand so every hop is checked.
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'AdStudio/1.0 (+product ads)', ...(accept ? { accept } : {}) },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await checkUrl(new URL(res.headers.get('location'), url).toString());
      continue;
    }
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    const length = Number(res.headers.get('content-length') || 0);
    if (length > maxBytes) throw Object.assign(new Error('Too large'), { userMessage: 'The file is too large.' });
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > maxBytes) throw Object.assign(new Error('Too large'), { userMessage: 'The file is too large.' });
      chunks.push(chunk);
    }
    return { buffer: Buffer.concat(chunks), type: res.headers.get('content-type') || '', url: url.toString() };
  }
  throw new Error('Too many redirects');
}
