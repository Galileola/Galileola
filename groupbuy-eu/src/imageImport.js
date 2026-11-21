import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { MAX_PHOTO_BYTES, MAX_PHOTOS_PER_DEAL, detectImageType } from './photos.js';

// Copies product photos from another shop's image addresses into UPLOAD_DIR after a CSV import,
// so the deal pages don't depend on the other site. Runs in the background, a few deals at a time.
//
// Only public addresses are fetched: the host name is checked when the connection is made (so a
// DNS answer can't point it at this server or the hosting company's private network), redirects
// are checked the same way, and the download stops at the photo size limit.

const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

export class ImageFetchError extends Error {}

// Loopback, private, link-local, carrier-grade NAT, multicast and other non-public addresses.
export function isPrivateAddress(address) {
  let ip = String(address).toLowerCase();
  if (ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7))) ip = ip.slice(7);
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (net.isIPv6(ip)) {
    return (
      ip === '::' || ip === '::1' ||
      /^f[cd]/.test(ip) || // unique local fc00::/7
      /^fe[89ab]/.test(ip) || // link-local fe80::/10
      /^ff/.test(ip) || // multicast
      ip.startsWith('64:ff9b:') || ip.startsWith('2001:db8:') || ip.startsWith('::ffff:')
    );
  }
  return true;
}

// dns.lookup that refuses non-public answers; used for every connection the importer makes.
function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = [].concat(addresses);
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || !list.length) return callback(new ImageFetchError(`${hostname} is not a public address`));
    if (options?.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

function checkUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new ImageFetchError('not a valid address');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ImageFetchError('only http and https addresses are copied');
  if (u.username || u.password) throw new ImageFetchError('addresses with a user name or password are not copied');
  if (u.port && !['80', '443'].includes(u.port)) throw new ImageFetchError('only the standard web ports are used');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || (net.isIP(host) && isPrivateAddress(host))) {
    throw new ImageFetchError('not a public address');
  }
  return u;
}

// Downloads one image and returns its bytes. Throws ImageFetchError with a short reason.
export async function downloadImage(rawUrl, { allowPrivate = false, redirects = 0 } = {}) {
  const u = allowPrivate ? new URL(rawUrl) : checkUrl(rawUrl);
  const client = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(
      u,
      {
        lookup: allowPrivate ? undefined : publicLookup,
        timeout: TIMEOUT_MS,
        headers: {
          // No AVIF: the photo store accepts JPG, PNG, WebP and GIF only (shop CDNs pick a format
          // from this header).
          Accept: 'image/webp,image/jpeg,image/png,image/gif;q=0.9,*/*;q=0.1',
          'User-Agent': 'Mozilla/5.0 (compatible; GroupBuy product import)',
        },
      },
      (res) => {
        const { statusCode = 0, headers } = res;
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          res.resume();
          if (redirects >= MAX_REDIRECTS) return reject(new ImageFetchError('too many redirects'));
          let next;
          try {
            next = new URL(headers.location, u).href;
          } catch {
            return reject(new ImageFetchError('bad redirect'));
          }
          return downloadImage(next, { allowPrivate, redirects: redirects + 1 }).then(resolve, reject);
        }
        if (statusCode !== 200) {
          res.resume();
          return reject(new ImageFetchError(`the other site answered ${statusCode}`));
        }
        if (Number(headers['content-length']) > MAX_PHOTO_BYTES) {
          res.destroy();
          return reject(new ImageFetchError(`larger than ${MAX_PHOTO_BYTES / 1024 / 1024} MB`));
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_PHOTO_BYTES) {
            res.destroy();
            reject(new ImageFetchError(`larger than ${MAX_PHOTO_BYTES / 1024 / 1024} MB`));
          } else chunks.push(chunk);
        });
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (!detectImageType(buf)) reject(new ImageFetchError('not a JPG, PNG, WebP or GIF image'));
          else resolve(buf);
        });
        res.on('error', (err) => reject(new ImageFetchError(err.message)));
      }
    );
    req.on('timeout', () => req.destroy(new ImageFetchError('the other site took too long')));
    req.on('error', (err) => reject(err instanceof ImageFetchError ? err : new ImageFetchError(networkReason(err))));
  });
}

const NETWORK_REASONS = {
  ENOTFOUND: "the other site's address was not found",
  EAI_AGAIN: "the other site's address could not be looked up",
  ECONNREFUSED: 'the other site refused the connection',
  ECONNRESET: 'the other site closed the connection',
  ETIMEDOUT: 'the other site took too long',
  CERT_HAS_EXPIRED: "the other site's security certificate has expired",
  DEPTH_ZERO_SELF_SIGNED_CERT: "the other site's security certificate isn't trusted",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "the other site's security certificate isn't trusted",
};
const networkReason = (err) => NETWORK_REASONS[err.code] ?? `the download failed (${err.code || err.message})`;

// Background queue: enqueue(dealId, urls) copies up to `perDeal` photos for that deal, in order.
// stats() reports progress for the admin.
export function createImageImporter({ photos, repo, clock, download = downloadImage, concurrency = 3, log = console }) {
  const queue = [];
  let running = 0;
  const stats = { photosQueued: 0, photosCopied: 0, photosFailed: 0, failures: [] };
  let idleWaiters = [];

  const pump = () => {
    while (running < concurrency && queue.length) {
      const job = queue.shift();
      running += 1;
      runJob(job).finally(() => {
        running -= 1;
        pump();
        if (!running && !queue.length) {
          for (const w of idleWaiters) w();
          idleWaiters = [];
        }
      });
    }
  };

  async function runJob({ dealId, urls }) {
    for (const url of urls) {
      if (!repo.dealById(dealId)) return;
      if (repo.photosForDeal(dealId).length >= MAX_PHOTOS_PER_DEAL) return;
      try {
        const buf = await download(url);
        repo.addPhoto(dealId, await photos.store(buf), clock.now().toISOString());
        stats.photosCopied += 1;
      } catch (err) {
        stats.photosFailed += 1;
        const reason = err instanceof ImageFetchError ? err.message : 'could not be saved';
        stats.failures.push({ dealId, url, reason });
        if (stats.failures.length > 50) stats.failures.shift();
        log.warn?.(`[import] photo for deal ${dealId} not copied (${reason}): ${url}`);
      }
    }
  }

  return {
    enqueue(dealId, urls, perDeal = 4) {
      const list = [...new Set(urls)].slice(0, Math.max(0, Math.min(MAX_PHOTOS_PER_DEAL, perDeal)));
      if (!list.length) return;
      stats.photosQueued += list.length;
      queue.push({ dealId, urls: list });
      pump();
    },
    stats: () => ({ ...stats, failures: [...stats.failures], busy: running > 0 || queue.length > 0 }),
    idle: () => (!running && !queue.length ? Promise.resolve() : new Promise((resolve) => idleWaiters.push(resolve))),
  };
}
