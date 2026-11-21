import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// All timestamps are ISO-8601 UTC strings (Date#toISOString), so string
// comparison in SQL matches chronological order. Money is integer cents (EUR).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS deals (
  id                 INTEGER PRIMARY KEY,
  slug               TEXT NOT NULL UNIQUE,
  product_name       TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  image_url          TEXT NOT NULL DEFAULT '',
  category           TEXT NOT NULL DEFAULT 'other',  -- slug from src/categories.js
  headline           TEXT NOT NULL DEFAULT '',       -- short ad line on the deal card
  social_post        TEXT NOT NULL DEFAULT '',       -- admin-only: ready-made post for social media
  seo_title          TEXT NOT NULL DEFAULT '',       -- search result title (content language only)
  seo_description    TEXT NOT NULL DEFAULT '',       -- search result / link preview text
  cancelled_at       TEXT,                           -- the owner cancelled it (status expired)
  price_cents        INTEGER NOT NULL CHECK (price_cents > 0),   -- gross, VAT included
  currency           TEXT NOT NULL DEFAULT 'eur',
  tax_code           TEXT NOT NULL,
  min_buyers         INTEGER NOT NULL CHECK (min_buyers >= 1),
  deadline           TEXT NOT NULL,
  -- open -> charging (48h window) -> ready_to_order ; open -> expired
  status             TEXT NOT NULL DEFAULT 'open',
  minimum_reached_at TEXT,
  grace_ends_at      TEXT,
  ready_at           TEXT,
  expired_at         TEXT,
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id                   INTEGER PRIMARY KEY,
  deal_id              INTEGER NOT NULL REFERENCES deals(id),
  token                TEXT NOT NULL UNIQUE,      -- secret for the buyer's links
  email                TEXT NOT NULL,
  name                 TEXT NOT NULL,
  address_line1        TEXT NOT NULL,
  address_line2        TEXT NOT NULL DEFAULT '',
  postal_code          TEXT NOT NULL,
  city                 TEXT NOT NULL,
  country              TEXT NOT NULL,             -- ISO 3166-1 alpha-2, EU only
  terms_accepted_at    TEXT NOT NULL,

  stripe_customer_id   TEXT,
  setup_intent_id      TEXT,
  payment_method_id    TEXT,
  payment_method_type  TEXT,                      -- card | sepa_debit
  payment_method_label TEXT,                      -- e.g. "Visa •••• 4242"
  mandate_id           TEXT,

  tax_calculation_id   TEXT,
  tax_expires_at       TEXT,
  amount_cents         INTEGER,                   -- gross amount to charge
  tax_cents            INTEGER,                   -- VAT share of amount_cents
  tax_rate_label       TEXT,
  tax_transaction_id   TEXT,

  -- pending_setup -> saved -> charging -> paid | processing | failed
  -- failed -> (retry / buyer fixes it) -> paid | processing | unpaid
  -- processing -> paid | failed (inside window) | late_failed (after window)
  -- saved/pending_setup -> released (deal expired) ; any -> withdrawn
  status               TEXT NOT NULL DEFAULT 'pending_setup',
  payment_intent_id    TEXT,
  attempts             INTEGER NOT NULL DEFAULT 0,
  needs_authentication INTEGER NOT NULL DEFAULT 0,
  last_error_code      TEXT,
  last_error_message   TEXT,
  first_charge_at      TEXT,
  grace_ends_at        TEXT,
  next_retry_at        TEXT,
  failure_email_sent_at TEXT,
  reminder_sent_at     TEXT,
  paid_at              TEXT,
  refund_id            TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS participants_deal ON participants(deal_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS participants_deal_email ON participants(deal_id, email);
CREATE INDEX IF NOT EXISTS participants_pi ON participants(payment_intent_id);
CREATE INDEX IF NOT EXISTS participants_si ON participants(setup_intent_id);

CREATE TABLE IF NOT EXISTS emails (
  id             INTEGER PRIMARY KEY,
  kind           TEXT NOT NULL,
  to_addr        TEXT NOT NULL,
  subject        TEXT NOT NULL,
  body           TEXT NOT NULL,
  deal_id        INTEGER,
  participant_id INTEGER,
  delivered      INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stripe_events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  received_at TEXT NOT NULL
);

-- Product photos uploaded in the admin. Files live in UPLOAD_DIR (outside the app folder);
-- the lowest position is the cover photo.
CREATE TABLE IF NOT EXISTS deal_photos (
  id         INTEGER PRIMARY KEY,
  deal_id    INTEGER NOT NULL REFERENCES deals(id),
  filename   TEXT NOT NULL UNIQUE,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS deal_photos_deal ON deal_photos(deal_id, position, id);

-- Leases so only one process runs the scheduler at a time (e.g. an old copy still running
-- after a redeploy on managed hosting).
-- Small admin settings changed in the admin itself (e.g. the admin password hash).
CREATE TABLE IF NOT EXISTS admin_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Translations of the shop's own content (deals, legal pages) made by Claude. source_hash is a
-- fingerprint of the original text, so an edited text gets a new translation.
CREATE TABLE IF NOT EXISTS translations (
  source_hash TEXT NOT NULL,
  lang        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  content     TEXT NOT NULL,
  model       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  PRIMARY KEY (source_hash, lang)
);

-- The legal pages as written by the shop owner in the admin, one text per page and language
-- (src/legalText.js). A language without its own text shows the English one, translated.
CREATE TABLE IF NOT EXISTS legal_texts (
  page       TEXT NOT NULL,
  lang       TEXT NOT NULL,
  body       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (page, lang)
);

-- Shop categories, edited in the admin (src/categories.js). names is JSON {lang: name}: names
-- the owner typed, which win over the built-in translations.
CREATE TABLE IF NOT EXISTS categories (
  slug     TEXT PRIMARY KEY,
  emoji    TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  names    TEXT NOT NULL DEFAULT '{}',
  hint     TEXT NOT NULL DEFAULT '',
  built_in INTEGER NOT NULL DEFAULT 0
);

-- Visit statistics (src/analytics.js): one row per page view. No IP addresses: visitor is a
-- fingerprint made with a key that changes every day. day is YYYY-MM-DD in the shop's time zone.
-- entry = 1 when the visit started on this page (it came from outside the shop); source, medium
-- and campaign say from where ('' for clicks inside the shop).
CREATE TABLE IF NOT EXISTS page_views (
  id         INTEGER PRIMARY KEY,
  day        TEXT NOT NULL,
  created_at TEXT NOT NULL,
  path       TEXT NOT NULL,
  deal_id    INTEGER,
  visitor    TEXT NOT NULL,
  entry      INTEGER NOT NULL DEFAULT 0,
  source     TEXT NOT NULL DEFAULT '',
  medium     TEXT NOT NULL DEFAULT '',
  campaign   TEXT NOT NULL DEFAULT '',
  referrer   TEXT NOT NULL DEFAULT '',
  lang       TEXT NOT NULL DEFAULT '',
  device     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS page_views_day ON page_views(day);
CREATE INDEX IF NOT EXISTS page_views_visitor ON page_views(day, visitor);

-- Money spent on adverts, typed in by the owner (Admin → Performance), so the dashboard can show
-- the cost per buyer and the return on ad spend. source and campaign match the tracked links.
CREATE TABLE IF NOT EXISTS ad_spend (
  id           INTEGER PRIMARY KEY,
  day          TEXT NOT NULL,
  source       TEXT NOT NULL,
  campaign     TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ad_spend_day ON ad_spend(day);

CREATE TABLE IF NOT EXISTS locks (
  name       TEXT PRIMARY KEY,
  holder     TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
`;

// journalMode: WAL is fastest; use DELETE if the host's filesystem doesn't support WAL
// (some network filesystems on shared hosting don't).
export function openDb(file, { journalMode = 'WAL' } = {}) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  const mode = /^(WAL|DELETE|TRUNCATE|PERSIST)$/i.test(journalMode) ? journalMode.toUpperCase() : 'WAL';
  db.exec(`PRAGMA journal_mode = ${mode}; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;`);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Columns added after the first release. CREATE TABLE IF NOT EXISTS leaves an existing table as
// it is, so databases created before then get the new columns here (once, at startup).
const ADDED_COLUMNS = {
  deals: [
    ['category', "TEXT NOT NULL DEFAULT 'other'"],
    ['headline', "TEXT NOT NULL DEFAULT ''"],
    ['social_post', "TEXT NOT NULL DEFAULT ''"],
    ['seo_title', "TEXT NOT NULL DEFAULT ''"],
    ['seo_description', "TEXT NOT NULL DEFAULT ''"],
    ['cancelled_at', 'TEXT'],
  ],
  // The language the buyer used on the site; their emails are written in it.
  participants: [
    ['lang', "TEXT NOT NULL DEFAULT 'en'"],
    // Where the buyer's visit came from (src/analytics.js): e.g. facebook / paid / summer-sale.
    ['source', "TEXT NOT NULL DEFAULT ''"],
    ['medium', "TEXT NOT NULL DEFAULT ''"],
    ['campaign', "TEXT NOT NULL DEFAULT ''"],
  ],
};

function migrate(db) {
  for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
    const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, ddl] of columns) {
      if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
    }
  }
  db.exec('CREATE INDEX IF NOT EXISTS deals_category ON deals(category, status)');
}

// Consistent copy of a live database (safe while the app runs). Keeps the newest `keep` files.
export function backupDb(db, dir, { keep = 14, now = new Date() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, `groupbuy-${stamp}.sqlite`);
  db.prepare('VACUUM INTO ?').run(target);
  const old = fs
    .readdirSync(dir)
    .filter((f) => /^groupbuy-.*\.sqlite$/.test(f))
    .sort()
    .reverse()
    .slice(keep);
  for (const f of old) fs.rmSync(path.join(dir, f));
  return target;
}

// Small repository layer. Column names in `fields` always come from code, never from user input.
export function createRepo(db) {
  const update = (table, id, fields) => {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = :${k}`).join(', ')} WHERE id = :__id`;
    db.prepare(sql).run({ ...nullify(fields), __id: id });
  };

  return {
    db,
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    // ---- deals
    insertDeal(d) {
      const r = db
        .prepare(
          `INSERT INTO deals (slug, product_name, description, image_url, category, headline, social_post,
             seo_title, seo_description, price_cents, currency, tax_code, min_buyers, deadline, created_at)
           VALUES (:slug, :product_name, :description, :image_url, :category, :headline, :social_post,
             :seo_title, :seo_description, :price_cents, 'eur', :tax_code, :min_buyers, :deadline, :created_at)`
        )
        .run({ category: 'other', headline: '', social_post: '', seo_title: '', seo_description: '', ...d });
      return this.dealById(Number(r.lastInsertRowid));
    },
    dealById: (id) => db.prepare('SELECT * FROM deals WHERE id = ?').get(id),
    dealBySlug: (slug) => db.prepare('SELECT * FROM deals WHERE slug = ?').get(slug),
    listDeals: () => db.prepare('SELECT * FROM deals ORDER BY created_at DESC').all(),
    listPublicDeals: () =>
      db.prepare(`SELECT * FROM deals WHERE status IN ('open','charging','ready_to_order') ORDER BY deadline ASC`).all(),
    dealsByStatus: (status) => db.prepare('SELECT * FROM deals WHERE status = ?').all(status),
    // Everyone who ever started joining, whatever happened since (deleting needs this to be 0).
    participantCount: (dealId) => db.prepare('SELECT COUNT(*) AS n FROM participants WHERE deal_id = ?').get(dealId).n,
    // Removes a deal nobody has joined, with its photo rows (the caller removes the files).
    deleteDeal(id) {
      return this.transaction(() => {
        if (this.participantCount(id) > 0) return false;
        db.prepare('DELETE FROM deal_photos WHERE deal_id = ?').run(id);
        db.prepare('UPDATE page_views SET deal_id = NULL WHERE deal_id = ?').run(id);
        db.prepare('UPDATE emails SET deal_id = NULL WHERE deal_id = ?').run(id);
        return db.prepare('DELETE FROM deals WHERE id = ?').run(id).changes === 1;
      });
    },
    updateDeal: (id, fields) => update('deals', id, fields),
    // Atomic status transition. Returns true only for the caller that won.
    transitionDeal(id, from, to, extra = {}) {
      const keys = Object.keys(extra);
      const sets = ['status = :to', ...keys.map((k) => `${k} = :${k}`)].join(', ');
      const froms = [].concat(from);
      const r = db
        .prepare(`UPDATE deals SET ${sets} WHERE id = :id AND status IN (${froms.map((_, i) => `:f${i}`).join(',')})`)
        .run({ ...nullify(extra), to, id, ...Object.fromEntries(froms.map((f, i) => [`f${i}`, f])) });
      return r.changes === 1;
    },

    // ---- photos (cover first)
    photosForDeal: (dealId) =>
      db.prepare('SELECT * FROM deal_photos WHERE deal_id = ? ORDER BY position, id').all(dealId),
    coverPhoto: (dealId) =>
      db.prepare('SELECT * FROM deal_photos WHERE deal_id = ? ORDER BY position, id LIMIT 1').get(dealId),
    photoById: (id) => db.prepare('SELECT * FROM deal_photos WHERE id = ?').get(id),
    addPhoto(dealId, filename, now) {
      const { next } = db
        .prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM deal_photos WHERE deal_id = ?')
        .get(dealId);
      db.prepare('INSERT INTO deal_photos (deal_id, filename, position, created_at) VALUES (?, ?, ?, ?)').run(
        dealId,
        filename,
        next,
        now
      );
    },
    makeCoverPhoto(id) {
      const photo = this.photoById(id);
      if (!photo) return;
      const { first } = db
        .prepare('SELECT COALESCE(MIN(position), 0) AS first FROM deal_photos WHERE deal_id = ?')
        .get(photo.deal_id);
      db.prepare('UPDATE deal_photos SET position = ? WHERE id = ?').run(first - 1, id);
    },
    deletePhoto: (id) => db.prepare('DELETE FROM deal_photos WHERE id = ?').run(id),

    // ---- participants
    insertParticipant(p) {
      const r = db
        .prepare(
          `INSERT INTO participants (deal_id, token, email, name, address_line1, address_line2, postal_code, city, country,
             lang, terms_accepted_at, created_at, updated_at)
           VALUES (:deal_id, :token, :email, :name, :address_line1, :address_line2, :postal_code, :city, :country,
             :lang, :terms_accepted_at, :created_at, :created_at)`
        )
        .run({ lang: 'en', ...p });
      return this.participantById(Number(r.lastInsertRowid));
    },
    participantById: (id) => db.prepare('SELECT * FROM participants WHERE id = ?').get(id),
    participantByToken: (t) => db.prepare('SELECT * FROM participants WHERE token = ?').get(t),
    participantByEmail: (dealId, email) =>
      db.prepare('SELECT * FROM participants WHERE deal_id = ? AND email = ?').get(dealId, email),
    participantBySetupIntent: (id) => db.prepare('SELECT * FROM participants WHERE setup_intent_id = ?').get(id),
    participantByPaymentIntent: (id) => db.prepare('SELECT * FROM participants WHERE payment_intent_id = ?').get(id),
    participantsForDeal: (dealId, statuses) => {
      if (!statuses) return db.prepare('SELECT * FROM participants WHERE deal_id = ? ORDER BY id').all(dealId);
      const s = [].concat(statuses);
      return db
        .prepare(`SELECT * FROM participants WHERE deal_id = ? AND status IN (${s.map(() => '?').join(',')}) ORDER BY id`)
        .all(dealId, ...s);
    },
    participantsWhere: (whereSql, params = {}) =>
      db.prepare(`SELECT * FROM participants WHERE ${whereSql} ORDER BY id`).all(params),
    updateParticipant: (id, fields, now) => update('participants', id, { ...fields, updated_at: now }),
    transitionParticipant(id, from, to, extra, now) {
      const fields = { ...extra, updated_at: now };
      const keys = Object.keys(fields);
      const froms = [].concat(from);
      const r = db
        .prepare(
          `UPDATE participants SET status = :to, ${keys.map((k) => `${k} = :${k}`).join(', ')}
           WHERE id = :id AND status IN (${froms.map((_, i) => `:f${i}`).join(',')})`
        )
        .run({ ...nullify(fields), to, id, ...Object.fromEntries(froms.map((f, i) => [`f${i}`, f])) });
      return r.changes === 1;
    },
    // Buyers who count towards the minimum: everyone with a saved method who hasn't left.
    committedCount: (dealId) =>
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM participants WHERE deal_id = ?
             AND status NOT IN ('pending_setup','released','withdrawn')`
        )
        .get(dealId).n,
    statusCounts: (dealId) =>
      Object.fromEntries(
        db
          .prepare('SELECT status, COUNT(*) AS n FROM participants WHERE deal_id = ? GROUP BY status')
          .all(dealId)
          .map((r) => [r.status, r.n])
      ),

    // ---- emails
    insertEmail: (e) =>
      Number(
        db
          .prepare(
            `INSERT INTO emails (kind, to_addr, subject, body, deal_id, participant_id, created_at)
             VALUES (:kind, :to_addr, :subject, :body, :deal_id, :participant_id, :created_at)`
          )
          .run(nullify(e)).lastInsertRowid
      ),
    markEmail: (id, fields) => update('emails', id, fields),
    listEmails: (limit = 200) => db.prepare('SELECT * FROM emails ORDER BY id DESC LIMIT ?').all(limit),
    emailsFor: (participantId) =>
      db.prepare('SELECT * FROM emails WHERE participant_id = ? ORDER BY id').all(participantId),

    // ---- webhook de-duplication
    recordEvent(id, type, now) {
      const r = db.prepare('INSERT OR IGNORE INTO stripe_events (id, type, received_at) VALUES (?, ?, ?)').run(id, type, now);
      return r.changes === 1;
    },
    forgetEvent: (id) => db.prepare('DELETE FROM stripe_events WHERE id = ?').run(id),

    // ---- leases: true if `holder` now holds `name` until now + ttlMs.
    acquireLock(name, holder, now, ttlMs) {
      const r = db
        .prepare(
          `INSERT INTO locks (name, holder, expires_at) VALUES (:name, :holder, :exp)
           ON CONFLICT(name) DO UPDATE SET holder = :holder, expires_at = :exp
           WHERE locks.expires_at <= :now OR locks.holder = :holder`
        )
        .run({ name, holder, exp: new Date(now.getTime() + ttlMs).toISOString(), now: now.toISOString() });
      return r.changes === 1;
    },
    releaseLock: (name, holder) => db.prepare('DELETE FROM locks WHERE name = ? AND holder = ?').run(name, holder),

    // ---- translations
    translation: (sourceHash, lang) =>
      db.prepare('SELECT * FROM translations WHERE source_hash = ? AND lang = ?').get(sourceHash, lang),
    saveTranslation: (t) =>
      db
        .prepare(
          `INSERT INTO translations (source_hash, lang, kind, content, model, created_at)
           VALUES (:source_hash, :lang, :kind, :content, :model, :created_at)
           ON CONFLICT(source_hash, lang) DO UPDATE SET content = excluded.content, kind = excluded.kind,
             model = excluded.model, created_at = excluded.created_at`
        )
        .run(t),

    // ---- categories
    listCategories: () => db.prepare('SELECT * FROM categories ORDER BY position, slug').all(),
    insertCategory: (c) =>
      db
        .prepare('INSERT INTO categories (slug, emoji, position, names, hint, built_in) VALUES (?, ?, ?, ?, ?, ?)')
        .run(c.slug, c.emoji, c.position, JSON.stringify(c.names ?? {}), c.hint ?? '', c.built_in ? 1 : 0),
    updateCategory: (slug, c) =>
      db
        .prepare('UPDATE categories SET emoji = ?, names = ?, hint = ? WHERE slug = ?')
        .run(c.emoji, JSON.stringify(c.names ?? {}), c.hint ?? '', slug),
    setCategoryPositions(slugs) {
      const stmt = db.prepare('UPDATE categories SET position = ? WHERE slug = ?');
      db.exec('BEGIN');
      try {
        slugs.forEach((slug, i) => stmt.run(i, slug));
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    // Removes a category; its deals move to `fallback`.
    deleteCategory(slug, fallback) {
      db.exec('BEGIN');
      try {
        db.prepare('UPDATE deals SET category = ? WHERE category = ?').run(fallback, slug);
        db.prepare('DELETE FROM categories WHERE slug = ?').run(slug);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    dealCountsByCategory: () =>
      Object.fromEntries(db.prepare('SELECT category, COUNT(*) AS n FROM deals GROUP BY category').all().map((r) => [r.category, r.n])),

    // ---- legal pages
    legalText: (page, lang) => db.prepare('SELECT * FROM legal_texts WHERE page = ? AND lang = ?').get(page, lang),
    legalTexts: () => db.prepare('SELECT page, lang, updated_at FROM legal_texts ORDER BY page, lang').all(),
    saveLegalText: (page, lang, body, now) =>
      db
        .prepare(
          `INSERT INTO legal_texts (page, lang, body, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(page, lang) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`
        )
        .run(page, lang, body, now),
    deleteLegalText: (page, lang) => db.prepare('DELETE FROM legal_texts WHERE page = ? AND lang = ?').run(page, lang),

    // ---- admin settings
    getAdminSetting: (key) => db.prepare('SELECT * FROM admin_settings WHERE key = ?').get(key),
    deleteAdminSetting: (key) => db.prepare('DELETE FROM admin_settings WHERE key = ?').run(key),
    // Removes settings whose key starts with `prefix` and that were last saved before `before`.
    deleteAdminSettingsBefore: (prefix, before) =>
      db.prepare("DELETE FROM admin_settings WHERE substr(key, 1, length(:prefix)) = :prefix AND updated_at < :before").run({ prefix, before }),
    setAdminSetting: (key, value, now) =>
      db
        .prepare(
          `INSERT INTO admin_settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        )
        .run(key, value, now),

    // ---- visit statistics and ad spend (src/analytics.js, src/performance.js)
    insertVisit: (v) =>
      db
        .prepare(
          `INSERT INTO page_views (day, created_at, path, deal_id, visitor, entry, source, medium, campaign, referrer, lang, device)
           VALUES (:day, :created_at, :path, :deal_id, :visitor, :entry, :source, :medium, :campaign, :referrer, :lang, :device)`
        )
        .run(nullify(v)),
    deleteVisitsBefore: (day) => db.prepare('DELETE FROM page_views WHERE day < ?').run(day),
    // The visitor's last source today that isn't "direct", else direct.
    lastVisitSource: (day, visitor) =>
      db
        .prepare(
          `SELECT source, medium, campaign FROM page_views WHERE day = ? AND visitor = ? AND entry = 1
           ORDER BY (source = 'direct'), id DESC LIMIT 1`
        )
        .get(day, visitor),
    setParticipantSource: (id, s) =>
      db.prepare('UPDATE participants SET source = ?, medium = ?, campaign = ? WHERE id = ?').run(s.source, s.medium, s.campaign, id),
    visitsByDay: (from, to) =>
      db
        .prepare(
          `SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors, SUM(entry) AS visits
           FROM page_views WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day`
        )
        .all(from, to),
    // Visitors and visits grouped by one of a fixed set of columns. Visitors are counted once
    // per day (the fingerprint changes daily).
    visitsBy(group, from, to, { entriesOnly = false } = {}) {
      const columns = { source: 'source', campaign: 'source, campaign', deal: 'deal_id', lang: 'lang', device: 'device', path: 'path' }[group];
      if (!columns) throw new Error(`unknown group ${group}`);
      const where = [`day BETWEEN ? AND ?`, entriesOnly ? 'entry = 1' : '', group === 'deal' ? 'deal_id IS NOT NULL' : '', group === 'campaign' ? "campaign != ''" : '']
        .filter(Boolean)
        .join(' AND ');
      return db
        .prepare(
          `SELECT ${columns}, COUNT(*) AS views, COUNT(DISTINCT day || visitor) AS visitors, SUM(entry) AS visits
           FROM page_views WHERE ${where} GROUP BY ${columns} ORDER BY visitors DESC`
        )
        .all(from, to);
    },
    firstVisitDay: () => db.prepare('SELECT MIN(day) AS day FROM page_views').get()?.day ?? null,
    // Orders created or paid since `iso` (enough columns for the dashboard, no personal data).
    participantsForReport: (iso) =>
      db
        .prepare(
          `SELECT id, deal_id, country, lang, status, payment_method_id, amount_cents, tax_cents, refund_id,
                  source, medium, campaign, created_at, paid_at
           FROM participants WHERE created_at >= ? OR paid_at >= ?`
        )
        .all(iso, iso),
    insertAdSpend: (a) =>
      db
        .prepare(
          `INSERT INTO ad_spend (day, source, campaign, amount_cents, note, created_at)
           VALUES (:day, :source, :campaign, :amount_cents, :note, :created_at)`
        )
        .run(a),
    adSpendBetween: (from, to) =>
      db.prepare('SELECT * FROM ad_spend WHERE day BETWEEN ? AND ? ORDER BY day DESC, id DESC').all(from, to),
    deleteAdSpend: (id) => db.prepare('DELETE FROM ad_spend WHERE id = ?').run(id),

    // Reminder claim: only one process may send it.
    claimReminder: (id, now) =>
      db
        .prepare(`UPDATE participants SET reminder_sent_at = :now, updated_at = :now WHERE id = :id AND status = 'failed' AND reminder_sent_at IS NULL`)
        .run({ id, now }).changes === 1,
  };
}

function nullify(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v === undefined ? null : typeof v === 'boolean' ? Number(v) : v;
  }
  return out;
}
