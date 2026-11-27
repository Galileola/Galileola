import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { db, DATA_DIR, now, parse } from './db.js';

// A job is one ad: a product photo turned into banners (and videos) in
// one or more sizes. Its record is in the database; its pictures are in
// OUTPUT_DIR/<job id>/ and are served under /files.
export const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(DATA_DIR, 'files'));
const TTL_MS = (Number(process.env.JOB_TTL_DAYS) || 60) * 86400 * 1000;

const live = new Map(); // id -> job (the same object everyone edits)
const buffers = new Map(); // id -> pictures kept in memory while working

export const newId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');

function dir(id) {
  return path.join(OUTPUT_DIR, id);
}

export function saveFile(id, name, buffer) {
  fs.mkdirSync(dir(id), { recursive: true });
  fs.writeFileSync(path.join(dir(id), name), buffer);
  return `/files/${id}/${name}`;
}

export function readFile(id, name) {
  try {
    return fs.readFileSync(path.join(dir(id), name));
  } catch {
    return null;
  }
}

export function filePath(url) {
  const m = /^\/files\/([\w-]+)\/([\w.-]+)$/.exec(url || '');
  return m ? path.join(dir(m[1]), m[2]) : null;
}

function decode(dataUri) {
  return Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64');
}

export async function prepareLogo(input) {
  if (!input) return null;
  const buffer = Buffer.isBuffer(input) ? input : decode(input);
  return sharp(buffer).trim({ threshold: 10 }).resize({ width: 800, height: 400, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
}

export function persist(job) {
  const { _working, ...data } = job;
  db.prepare(`INSERT INTO jobs (id, client_id, batch_id, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`)
    .run(job.id, job.clientId, job.batchId, job.status, JSON.stringify(data), job.createdAt, now());
}

/**
 * Creates a job and stores its photo (and logo) on disk. `request` holds
 * the brief: brand, offer, details, style, language, formats and the brand
 * kit fields when the ad is for a saved client.
 */
export async function createJob(request, { photo, logo, clientId = null, batchId = null }) {
  const id = newId();
  const jpeg = await sharp(Buffer.isBuffer(photo) ? photo : decode(photo))
    .rotate()
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
  saveFile(id, 'photo.jpg', jpeg);
  const logoPng = await prepareLogo(logo);
  if (logoPng) saveFile(id, 'logo.png', logoPng);

  const job = {
    id,
    clientId,
    batchId,
    createdAt: now(),
    status: 'queued',
    stage: 'queued',
    error: null,
    request,
    photo: `/files/${id}/photo.jpg`,
    brief: null,
    formats: Object.fromEntries(request.formats.map((f) => [f, { stage: 'waiting' }])),
    tones: {},
    videos: {},
    avatar: null,
    version: 1,
  };
  live.set(id, job);
  persist(job);
  return job;
}

export function getJob(id) {
  if (live.has(id)) return live.get(id);
  const job = parse(db.prepare('SELECT data FROM jobs WHERE id = ?').get(id));
  if (job) live.set(id, job);
  return job;
}

export function listJobs({ clientId, batchId, limit = 30 } = {}) {
  let sql = 'SELECT data FROM jobs';
  const args = [];
  if (batchId) {
    sql += ' WHERE batch_id = ?';
    args.push(batchId);
  } else if (clientId) {
    sql += ' WHERE client_id = ?';
    args.push(clientId);
  }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  args.push(limit);
  return db.prepare(sql).all(...args).map((row) => live.get(JSON.parse(row.data).id) ?? parse(row));
}

/**
 * The pictures a job works with: the photo, the cut-out product, the
 * finished scenes and the brand (name and logo). Loaded from disk after a
 * restart.
 */
export async function jobFiles(job) {
  let f = buffers.get(job.id);
  if (!f) {
    f = { scenes: {} };
    buffers.set(job.id, f);
  }
  f.mime = 'image/jpeg';
  f.photo ??= readFile(job.id, 'photo.jpg');
  if (!f.cutout) {
    const buffer = readFile(job.id, 'cutout.png');
    if (buffer) {
      const { width, height } = await sharp(buffer).metadata();
      f.cutout = { buffer, width, height, aspect: height / width };
    }
  }
  for (const [formatId, state] of Object.entries(job.formats)) {
    if (!f.scenes[formatId] && state.scene) f.scenes[formatId] = readFile(job.id, path.basename(state.scene));
  }
  if (!f.brand) {
    const logo = readFile(job.id, 'logo.png');
    let logoInfo = null;
    if (logo) {
      const { width, height } = await sharp(logo).metadata();
      logoInfo = { dataUri: `data:image/png;base64,${logo.toString('base64')}`, width, height };
    }
    f.brand = { name: job.request.brand, logo: logoInfo };
  }
  return f;
}

export function publicJob(job) {
  const { _working, ...rest } = job;
  return rest;
}

// Jobs that were waiting or running when the server stopped.
export function unfinishedJobs() {
  return db.prepare("SELECT data FROM jobs WHERE status IN ('queued', 'running') ORDER BY created_at").all().map((row) => getJob(JSON.parse(row.data).id));
}

function busy(job) {
  return job.status === 'running' || job.status === 'queued'
    || Object.values(job.formats).some((f) => !['done', 'error', 'waiting'].includes(f.stage))
    || Object.values(job.videos || {}).some((v) => ['starting', 'rendering', 'finishing'].includes(v.status))
    || ['working'].includes(job.avatar?.status);
}

/** Saves busy jobs every few seconds, and removes old jobs and their files. */
export function startHousekeeping() {
  setInterval(() => {
    for (const job of live.values()) if (busy(job)) persist(job);
  }, 2000).unref();

  const sweep = () => {
    const cutoff = new Date(Date.now() - TTL_MS).toISOString();
    for (const row of db.prepare('SELECT id FROM jobs WHERE created_at < ?').all(cutoff)) {
      fs.rmSync(dir(row.id), { recursive: true, force: true });
      db.prepare('DELETE FROM reviews WHERE job_id = ?').run(row.id);
      db.prepare('DELETE FROM jobs WHERE id = ?').run(row.id);
      live.delete(row.id);
      buffers.delete(row.id);
    }
    // Finished jobs don't need their pictures in memory.
    for (const [id, job] of live) {
      if (!busy(job)) {
        buffers.delete(id);
        live.delete(id);
      }
    }
    db.prepare('DELETE FROM oauth_states WHERE created_at < ?').run(new Date(Date.now() - 3600 * 1000).toISOString());
  };
  sweep();
  setInterval(sweep, 3600 * 1000).unref();
}
