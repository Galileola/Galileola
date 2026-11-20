import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Settings shared by every copy of the shop on one hosting account.
//
// Hosting panels keep environment variables per website and nobody can read them back, so moving
// the shop to another domain would mean typing every key again. Instead the running shop keeps a
// private copy of its settings in ~/.groupbuy/settings.env (outside every website folder,
// readable only by the hosting account), and a copy of the shop on another domain of the same
// account starts from it. Variables set in the panel always win over the file. BASE_URL and PORT
// belong to each website and are never shared.
//
// SETTINGS_FILE=off turns this off; SETTINGS_FILE=/some/path reads that file instead (the copy is
// still saved to the account's file, so later starts don't need SETTINGS_FILE).

export const SHARED_KEYS = [
  'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET',
  'DATABASE_PATH', 'BACKUP_DIR', 'BACKUP_KEEP', 'SQLITE_JOURNAL_MODE', 'TRUST_PROXY', 'UPLOAD_DIR',
  'APP_SECRET', 'ADMIN_USER', 'ADMIN_PASSWORD', 'CRON_SECRET', 'SCHEDULER_INTERVAL_MS', 'JOIN_RATE_LIMIT',
  'SMTP_URL', 'MAIL_FROM', 'DEFAULT_TAX_CODE',
  'BUSINESS_NAME', 'BUSINESS_ADDRESS', 'BUSINESS_EMAIL', 'BUSINESS_VAT_ID', 'BUSINESS_REGISTRATION', 'BUSINESS_DPA',
  'ANTHROPIC_API_KEY', 'ASSISTANT_MODEL', 'ASSISTANT_RATE_LIMIT', 'ASSISTANT_DAILY_LIMIT',
];
const PATH_KEYS = new Set(['DATABASE_PATH', 'BACKUP_DIR', 'UPLOAD_DIR']);
const DEFAULT_DATABASE_PATH = './data/groupbuy.sqlite'; // keep in sync with src/config.js

// The hosting account's own home folder. Hostinger gives every website its own HOME
// (/home/<user>/domains/<domain>), so os.homedir() differs per website; the account's home from
// the user database is the same for all of them.
function accountHome() {
  try {
    return os.userInfo().homedir || os.homedir();
  } catch {
    return os.homedir();
  }
}

// Where this copy saves the shared settings (null when turned off).
export function settingsFilePath(env = process.env) {
  if (env.SETTINGS_FILE === 'off') return null;
  return path.join(accountHome(), '.groupbuy', 'settings.env');
}

// Where this copy reads them from: SETTINGS_FILE when set, else the account's file, else the
// website's own home (where earlier versions saved it).
export function settingsFileCandidates(env = process.env) {
  if (env.SETTINGS_FILE === 'off') return [];
  return [...new Set([env.SETTINGS_FILE, settingsFilePath(env), path.join(os.homedir(), '.groupbuy', 'settings.env')].filter(Boolean))];
}

// Fills in settings missing from `env` from the file. Returns the keys it filled in.
export function loadSettingsFile(env = process.env, file = settingsFileCandidates(env).find((f) => fs.existsSync(f))) {
  if (!file || !fs.existsSync(file)) return [];
  const filled = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m || !SHARED_KEYS.includes(m[1]) || env[m[1]] !== undefined) continue;
    try {
      const value = JSON.parse(m[2]);
      if (typeof value !== 'string') continue;
      env[m[1]] = value;
      filled.push(m[1]);
    } catch {
      // not a value this file writes: ignore the line
    }
  }
  return filled;
}

// Writes the shared settings from `env` once, if the file doesn't exist yet. Paths are stored
// absolute, so another website folder finds the same database. Returns true when it wrote.
export function saveSettingsFile(env = process.env, file = settingsFilePath(env), cwd = process.cwd()) {
  if (!file || fs.existsSync(file) || !env.STRIPE_SECRET_KEY) return false;
  const lines = ['# Group Buy settings shared by the copies of the shop on this account. See src/settingsFile.js.'];
  for (const key of SHARED_KEYS) {
    let value = env[key];
    if (key === 'DATABASE_PATH') value = value || DEFAULT_DATABASE_PATH;
    if (value === undefined || value === '') continue;
    if (PATH_KEYS.has(key)) value = path.resolve(cwd, value);
    lines.push(`${key}=${JSON.stringify(value)}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, lines.join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, file);
  return true;
}
