import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Jobs live in memory; their files live in OUTPUT_DIR/<job id>/ and are
// served under /files. A restart forgets running jobs but keeps the files.
export const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || 'output');
const TTL_MS = (Number(process.env.JOB_TTL_HOURS) || 48) * 3600 * 1000;

const jobs = new Map();

export function createJob(request) {
  const id = crypto.randomBytes(9).toString('base64url');
  fs.mkdirSync(path.join(OUTPUT_DIR, id), { recursive: true });
  const job = {
    id,
    createdAt: new Date().toISOString(),
    status: 'running',
    stage: 'brief',
    error: null,
    request,
    brief: null,
    formats: Object.fromEntries(request.formats.map((f) => [f, { stage: 'waiting' }])),
    videos: {},
    version: 1,
  };
  jobs.set(id, { job, files: {} });
  return job;
}

export function getJob(id) {
  return jobs.get(id)?.job ?? null;
}

// Buffers kept next to a job (photo, cut-out, scenes) for re-typesetting and video.
export function jobFiles(id) {
  return jobs.get(id)?.files ?? null;
}

export function runningCount() {
  let n = 0;
  for (const { job } of jobs.values()) if (job.status === 'running') n++;
  return n;
}

export function saveFile(id, name, buffer) {
  fs.writeFileSync(path.join(OUTPUT_DIR, id, name), buffer);
  return `/files/${id}/${name}`;
}

export function publicJob(job) {
  const { request, ...rest } = job;
  const { photo, logo, ...req } = request;
  return { ...rest, request: req };
}

// Removes jobs and their files after JOB_TTL_HOURS.
export function startCleanup() {
  const sweep = () => {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, { job }] of jobs) {
      if (Date.parse(job.createdAt) < cutoff) jobs.delete(id);
    }
    if (!fs.existsSync(OUTPUT_DIR)) return;
    for (const name of fs.readdirSync(OUTPUT_DIR)) {
      const dir = path.join(OUTPUT_DIR, name);
      try {
        if (fs.statSync(dir).mtimeMs < cutoff) fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // already gone
      }
    }
  };
  sweep();
  setInterval(sweep, 3600 * 1000).unref();
}
