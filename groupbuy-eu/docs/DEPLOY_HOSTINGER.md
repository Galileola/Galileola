# Deploying on Hostinger

This app runs on Hostinger in two ways:

| | **Web hosting: Business or Cloud plan** ("Node.js Web Apps" in hPanel) | **Hostinger VPS** |
|---|---|---|
| Setup effort | Low: upload a ZIP, fill in settings | Medium: you run a Linux server |
| App when idle | **Stopped** after a while without traffic, restarted by the next request | Always running |
| Scheduler | An hPanel **cron job must call it every minute** | Built in |
| Database file | Must live **outside** the app folder | Anywhere on disk |

Both work. Web hosting is the simpler choice; follow part A. Part B is the VPS route.

Hostinger's menus get renamed from time to time, so the hPanel labels below may differ slightly.
Their Node.js docs are at https://docs.hostinger.com/node.js/overview.

---

## Before you start (both routes)

1. **Domain with HTTPS.** Stripe redirects and webhooks need `https://`. Hostinger includes free SSL.
2. **Stripe test account set up** (Dashboard → Test mode):
   - Settings → Payment methods: turn on **Cards**, **SEPA Direct Debit** and **iDEAL**.
   - Settings → Tax: set your origin address and add test registrations (otherwise VAT shows €0).
3. **Secrets.** Generate three long random values: one each for `APP_SECRET`, `CRON_SECRET` and
   `ADMIN_PASSWORD`. On any computer with Node.js:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. **A mailbox for sending**, for example `shop@yourdomain.com` (hPanel → Emails).
   - Add SPF, DKIM and DMARC records so buyer emails don't land in spam. hPanel's email DNS
     settings can add them for you.

---

## A. Hostinger web hosting (Business or Cloud plan)

### A1. Make a folder for the database, outside the app

The app stores everything (deals, buyers, payment status) in one SQLite file. Hostinger replaces
the app's files when you redeploy. Keep the database **outside** the app folder so it survives.

1. hPanel → **File Manager**. Note your home folder path, for example `/home/u123456789`.
2. Create a folder there: `/home/u123456789/groupbuy-data`.

You'll use these two paths in the settings:

```
DATABASE_PATH=/home/u123456789/groupbuy-data/groupbuy.sqlite
BACKUP_DIR=/home/u123456789/groupbuy-data/backups
```

When the app starts it logs where the database is. It prints a **WARNING** if the database is
inside the app folder.

### A2. Get the ZIP

Use the `groupbuy-eu.zip` you were given, or build it yourself from the repository with
`npm run package`. That writes `dist/groupbuy-eu.zip` from the last commit, without
`node_modules`, `.env`, the database or the tests.

Once the code is on GitHub, you can connect the repository in hPanel instead of uploading ZIPs.

### A3. Create the Node.js app

hPanel → **Websites → Add website → Node.js app** (on some accounts: **Web Apps**). Then:

| Setting | Value |
|---|---|
| Source | Upload ZIP (or GitHub) |
| Node.js version | **22.x** (or 24.x). **Not 18 or 20**: the app needs 22.13+ and stops with a clear message otherwise |
| Framework / preset | Express, or "Other" |
| Entry file | `src/start.js` |
| Install / build command | `npm install` (or leave the default) |
| Start command | `npm start` |

Hostinger provides the port through `PORT`, so don't set it yourself.

### A4. Environment variables

In the app's settings, open **Environment variables**. Add these one by one, or use **Import .env**
with a file like this. Replace every value in angle brackets.

```
BASE_URL=https://<yourdomain.com>
STRIPE_SECRET_KEY=sk_test_<…>
STRIPE_PUBLISHABLE_KEY=pk_test_<…>
STRIPE_WEBHOOK_SECRET=whsec_<from step A6>
APP_SECRET=<random>
ADMIN_USER=admin
ADMIN_PASSWORD=<random or a strong password>
CRON_SECRET=<random>
DATABASE_PATH=/home/<u123456789>/groupbuy-data/groupbuy.sqlite
BACKUP_DIR=/home/<u123456789>/groupbuy-data/backups
TRUST_PROXY=1
SMTP_URL=smtps://<shop%40yourdomain.com>:<url-encoded-password>@smtp.hostinger.com:465
MAIL_FROM=<Your Shop> <shop@yourdomain.com>
BUSINESS_NAME=<Company name>
BUSINESS_ADDRESS=<Street 1, 1234 AB City, Country>
BUSINESS_EMAIL=<support@yourdomain.com>
BUSINESS_VAT_ID=<EU VAT number>
BUSINESS_REGISTRATION=<Company register and number>
BUSINESS_DPA=<Your national data protection authority>
```

Notes on these values:

- **`SMTP_URL`:** write the `@` in the mailbox name as `%40`. URL-encode special characters in
  the password (e.g. `#` → `%23`, `/` → `%2F`, `:` → `%3A`). If port 465 fails, try
  `smtp://…@smtp.hostinger.com:587`.
- **Stripe keys:** use test keys only. The app refuses to start with live keys.
- **After changing variables**, restart the app in hPanel so it picks them up.

### A5. Deploy and check

1. Deploy, then open `https://<yourdomain>/healthz`. Expected: `{"ok":true}`.
2. Open the app's **logs** in hPanel. Expected:
   - `[db] /home/<u…>/groupbuy-data/groupbuy.sqlite …` with **no WARNING** below it.
   - `Group buy running at https://<yourdomain> … (Stripe TEST mode)`.
3. Open `https://<yourdomain>/admin` and log in with `ADMIN_USER` / `ADMIN_PASSWORD`.

### A6. Stripe webhook

Stripe Dashboard (Test mode) → **Developers → Webhooks** (or **Workbench → Event destinations**)
→ **Add endpoint**:

- URL: `https://<yourdomain>/webhooks/stripe`
- Events: `setup_intent.succeeded`, `payment_intent.succeeded`, `payment_intent.processing`,
  `payment_intent.payment_failed`

Copy the **signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET` and restart the app. To
check it, send a test event from the Stripe Dashboard. It should show a `200` response.

### A7. Cron jobs (required on web hosting)

Hostinger stops the app when nobody visits it. Without a cron job, deadlines, payment retries
and the 48-hour cutoff only happen when someone happens to open the site.

hPanel → **Advanced → Cron Jobs** (or search "Cron Jobs"). Cron runs on UTC. Add:

**Every minute** (`* * * * *`): runs the scheduler and keeps the app awake.
```bash
curl -fsS -m 20 -X POST -H "Authorization: Bearer <CRON_SECRET>" https://<yourdomain>/api/cron/tick
```

**Once a day**, e.g. `17 3 * * *`: database backup to `BACKUP_DIR`, keeping the last 14.
```bash
curl -fsS -m 60 -X POST -H "Authorization: Bearer <CRON_SECRET>" https://<yourdomain>/api/cron/backup
```

How these behave:

- The tick endpoint answers `202` straight away and does its work in the background, so
  Hostinger's 120-second request limit never cuts it off.
- If two copies of the app are running (Hostinger mentions an old copy can linger after a
  redeploy), a lock in the database lets only one run the scheduler.

### A8. Prove the database survives a redeploy

Do this once, before real testing:

1. Admin → **New deal** → create "Persistence test".
2. Redeploy the same ZIP.
3. Reload `/admin`. "Persistence test" must still be there. If it's gone, `DATABASE_PATH`
   points inside the app folder: fix it (A1, A4) and redeploy.

### A9. Updating the site

Upload a new ZIP (or push to GitHub) and redeploy. The database folder isn't touched. Download
an off-site copy first: **Admin → Download database backup**.

### Troubleshooting

| Symptom | Fix |
|---|---|
| `Node.js 20.x is too old` in logs | Choose Node.js 22.x or 24.x in the app settings and redeploy |
| `disk I/O error` or `database is locked` at startup | Add `SQLITE_JOURNAL_MODE=DELETE` and restart |
| Deals stay "open" after the deadline | The every-minute cron job isn't running. Check its log in hPanel and that `CRON_SECRET` matches |
| Webhook shows 400 in Stripe | `STRIPE_WEBHOOK_SECRET` doesn't match the endpoint's signing secret; restart after fixing |
| No emails arrive | Check **Admin → Email outbox** for the error text; usually `SMTP_URL` encoding or port |
| Payment form doesn't appear | Browser console: look for "Content Security Policy" errors and report the blocked domain |
| Old behaviour after a redeploy | Restart the app in hPanel |

---

## B. Hostinger VPS

On a VPS the app runs permanently, so the built-in scheduler works and cron isn't needed.

1. Create the VPS with Ubuntu 24.04. Point your domain's A record at its IP.
2. Install Node.js 22, Caddy (automatic HTTPS) and unzip:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt-get install -y nodejs caddy unzip
   ```
3. Put the app in `/opt/groupbuy`, install its dependencies and create a service user:
   ```bash
   sudo mkdir -p /opt/groupbuy /var/lib/groupbuy && sudo unzip groupbuy-eu.zip -d /opt/groupbuy
   ```
   ```bash
   cd /opt/groupbuy && sudo npm ci --omit=dev && sudo useradd --system groupbuy && sudo chown -R groupbuy /var/lib/groupbuy
   ```
4. Create `/opt/groupbuy/.env` from `.env.example` with:
   - `BASE_URL=https://<yourdomain>`
   - `PORT=3000`
   - `DATABASE_PATH=/var/lib/groupbuy/groupbuy.sqlite`
   - `TRUST_PROXY=1`
   - plus the Stripe, secret, SMTP and business values from A4.

   Then make it readable only by the app:
   ```bash
   sudo chown root:groupbuy /opt/groupbuy/.env && sudo chmod 640 /opt/groupbuy/.env
   ```
5. Create `/etc/systemd/system/groupbuy.service`:
   ```ini
   [Unit]
   Description=Group Buy
   After=network.target

   [Service]
   User=groupbuy
   WorkingDirectory=/opt/groupbuy
   ExecStart=/usr/bin/npm start
   Restart=always
   KillSignal=SIGTERM
   TimeoutStopSec=30

   [Install]
   WantedBy=multi-user.target
   ```
   ```bash
   sudo systemctl daemon-reload && sudo systemctl enable --now groupbuy
   ```
6. Create `/etc/caddy/Caddyfile`, then reload Caddy:
   ```
   yourdomain.com {
     reverse_proxy 127.0.0.1:3000
   }
   ```
   ```bash
   sudo systemctl reload caddy
   ```
7. Do the Stripe webhook step (A6). For backups, add a daily root cron entry that calls
   `/api/cron/backup` as in A7, and copy `/var/lib/groupbuy/backups` off the server.

## Moving the shop to another domain (done for sekdigital.eu, Nov 2026)

The shop moved from shop.sekdigital.eu to sekdigital.eu like this:

1. **Settings without retyping them.** The running shop keeps a private copy of its settings in
   `/home/<user>/.groupbuy/settings.env` (readable only by the hosting account, outside every
   website folder; see `src/settingsFile.js`). A copy of the shop on another domain of the same
   account starts from it, so the new website only needs `BASE_URL`. Variables set in hPanel
   always win over the file. Both copies use the same `DATABASE_PATH`, so deals, buyers and
   photos stay where they are.
2. **CDN off for the new domain.** With the Hostinger CDN on, sekdigital.eu was unreachable (the
   secure connection failed at the CDN). Turning the CDN off pointed DNS straight at the server.
3. **Stripe webhook** URL changed to `https://<new domain>/webhooks/stripe` (same signing secret).
4. **Cron jobs** in hPanel changed to call the new domain.
5. **The old address** runs `redirect/` (no settings needed), which forwards every request to the
   same path on the new domain, so links in emails buyers already have keep working.

To change a setting later, edit it in hPanel → sekdigital.eu → Node.js → Environment variables
(that overrides the file), for example to add `ANTHROPIC_API_KEY`.
