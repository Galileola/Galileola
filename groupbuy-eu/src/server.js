import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';
import { loadConfig, ConfigError } from './config.js';
import { openDb, createRepo } from './db.js';
import { createApp } from './app.js';
import { systemClock } from './util.js';
import { allRoutes } from './routes/index.js';
import { createMailer } from './mailer.js';
import { createEngine } from './engine.js';
import { startScheduler } from './scheduler.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

// Managed hosts (Hostinger web apps) may replace the app folder on every redeploy, which would
// delete a database stored inside it. Keep DATABASE_PATH outside the app folder there.
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = path.resolve(config.dbPath);
console.log(`[db] ${dbFile} (journal ${config.sqliteJournalMode}); backups go to ${config.backupDir}`);
if (dbFile.startsWith(appRoot + path.sep)) {
  console.warn(
    '[db] WARNING: the database is inside the app folder. If your host replaces this folder on redeploy, ' +
      'all deals and buyers are lost. Set DATABASE_PATH to a folder outside the app (see docs/DEPLOY_HOSTINGER.md).'
  );
}

const db = openDb(config.dbPath, { journalMode: config.sqliteJournalMode });
const repo = createRepo(db);
const stripe = new Stripe(config.stripeSecretKey, {
  maxNetworkRetries: 2,
  appInfo: { name: 'groupbuy-eu' },
});
const clock = systemClock;

const ctx = { config, repo, stripe, clock, routes: allRoutes };
ctx.mailer = createMailer(ctx);
ctx.engine = createEngine(ctx);
const app = createApp(ctx);

let stopScheduler = () => {};
const server = app.listen(config.port, () => {
  console.log(`Group buy running at ${config.baseUrl} on port ${config.port} (Stripe TEST mode)`);
  stopScheduler = startScheduler(ctx.engine, config.schedulerIntervalMs);
});

// Hosts stop idle apps with SIGTERM: finish in-flight Stripe calls before exiting so no buyer
// is left half-charged (anything that still is gets reconciled by the next scheduler run).
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal}: finishing in-flight work…`);
  stopScheduler();
  server.close();
  const timeout = new Promise((resolve) => setTimeout(resolve, 20_000).unref());
  await Promise.race([ctx.engine.drain(), timeout]);
  db.close();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
