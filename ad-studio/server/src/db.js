import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Everything the agency keeps lives in DATA_DIR: the database (clients,
// ads, approvals, connections) and the image and video files.
export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'adstudio.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS client_secrets (client_id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, client_id TEXT, batch_id TEXT, status TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS jobs_client ON jobs (client_id, created_at);
  CREATE INDEX IF NOT EXISTS jobs_batch ON jobs (batch_id);
  CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, client_id TEXT, data TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS reviews (token TEXT PRIMARY KEY, job_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS reviews_job ON reviews (job_id);
  CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL);
`);

export const now = () => new Date().toISOString();

export function parse(row) {
  return row ? JSON.parse(row.data) : null;
}
