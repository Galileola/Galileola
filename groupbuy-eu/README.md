# Group Buy (EU)

A group-buying site for the EU market. Buyers save a payment method when they join a deal. They
are charged only if the deal reaches its minimum number of buyers before the deadline.

**Stripe test mode only.** The app refuses to start unless both Stripe keys are test-mode keys,
and it rejects live-mode webhook events.

Stack: Node.js ≥ 22.13 (built-in SQLite), Express 5, EJS templates, Stripe, Nodemailer.

## How it works

```
Admin creates deal ──► buyers join (SetupIntent: card / SEPA / iDEAL→SEPA, no charge)
                              │
         deadline passes      │      minimum reached
        below minimum ◄───────┴───────► charge every saved method off-session
              │                                │
   expired: methods detached,         paid / SEPA processing ─► counts as paid
   nobody charged                     failed (decline or SCA) ─► email link, retries
                                                │
                                     48h after the minimum ─► ready to order
                                     still unpaid ─► order cancelled (your cost)
```

- **Deals**: product, gross EUR price (VAT included), minimum buyers, deadline (at most 30 days
  out), and a Stripe Tax product code.
- **Joining**: name, email, EU delivery address and acceptance of the terms. Stripe Tax works out
  the VAT share for the delivery country, with `tax_behavior: inclusive`. The gross price is the
  same for everyone; only the VAT share inside it varies. Then the Payment Element runs on an
  off-session SetupIntent with `card`, `sepa_debit` and `ideal`. iDEAL is used only to create a
  SEPA mandate: later charges use the SEPA method that the iDEAL setup generates. If the
  account hasn't activated iDEAL (or SEPA), Stripe rejects that type and the app drops it.
- **Public deal page**: buyers vs minimum, a progress bar and a countdown, polling `/api/deals/:slug`.
- **Minimum reached**: the deal moves to `charging` and a 48-hour window opens. Each buyer gets
  one PaymentIntent (`off_session`, idempotency key `charge-<id>`). Retries re-confirm that same
  PaymentIntent, so nobody can be charged twice. The "we're collecting now" email doubles as
  the SEPA pre-notification.
- **Failures**:
  - Declined cards are retried at +6 h, +24 h and +44 h.
  - SCA (`authentication_required`), hard declines and SEPA bounces wait for the buyer instead
    of retrying blindly.
  - The buyer gets an email linking to `/pay/<token>`. There they can confirm the same
    PaymentIntent on-session, with the saved card (3-D Secure) or a new card or SEPA account.
  - A reminder goes out 24 h before their window ends.
- **After 48 hours**:
  - The deal becomes `ready_to_order`.
  - Unpaid buyers are cancelled: their PaymentIntent is cancelled, their method detached, and
    the amount shown in the admin as your cost.
  - SEPA debits still processing count as paid. If one bounces later, it is flagged as
    `late_failed` (your cost).
  - Late joiners (after the minimum, until the deadline) are charged immediately and get their
    own 48-hour window.
- **Deadline missed**: the deal becomes `expired`, every saved method is detached, unfinished
  SetupIntents are cancelled, and nobody is charged.
- **VAT records**: a Stripe Tax transaction is created when a payment succeeds, and reversed
  on a refund.
- **Order list**: the admin can download a CSV of everyone who paid (SEPA still processing
  counts), with delivery address and VAT per country. It opens correctly in Excel, and buyer
  input can't inject spreadsheet formulas.
- **Withdrawal (EU 14-day right)**: an admin action. Uncharged buyers are released; paid buyers
  get a full refund and a Stripe Tax reversal.
- **Legal pages**: `/terms` (when payment is taken, the 48-hour rule, the withdrawal right and
  the model form), `/privacy` (GDPR) and `/cookies`, plus a consent banner. Stripe.js only
  loads on payment pages.
- **Product photos**: the admin uploads up to 8 photos per deal (JPG, PNG, WebP or GIF, 8 MB
  each) when creating it or later on the deal page, and picks the cover. The type is checked
  from the file contents. Files go to `UPLOAD_DIR` (default: `uploads` next to the database,
  so keep `DATABASE_PATH` outside the app folder) and are served at `/uploads/<random name>`.
  They aren't in the database backups: copy that folder too.
- **AI shopping assistant**: a chat window on the public pages, answered by Claude
  (`claude-opus-5-5` at low effort) from the open deals and the shop's rules. It has no tools,
  can't see orders or payments, and the conversation stays in the visitor's browser tab. It
  stays off until `ANTHROPIC_API_KEY` is set; `ASSISTANT_RATE_LIMIT` and
  `ASSISTANT_DAILY_LIMIT` cap usage. If the model declines a message, the API's server-side
  fallback answers on another model.
- **Categories**: every deal has one of 12 standard categories (Electronics, Home & Kitchen,
  Fashion, Beauty & Health, Sports & Outdoors, Toys & Kids, Food & Drinks, Garden & DIY, Pets,
  Books & Hobbies, Car & Motorbike, Other). The home page has a chip for each one with its number of
  open deals, and `/?category=<slug>` lists one category. The admin picks the category on the New
  deal form and can change it on the deal page. The list lives in `src/categories.js`. Databases
  from before categories existed get the new columns at startup, and their deals show as "Other".
- **Snap a deal** (admin, `/admin/snap`, made for phones): tap the camera button and photograph a
  product. The photo is shrunk in the browser (which also strips its GPS location) and sent to
  Claude, which writes the whole ad: product name, headline, category, the deal-page text and a
  social media post with hashtags. The admin adds the price (and changes the minimum buyers or
  the 1-week deadline if needed), checks the text and taps **Publish**: the deal is live in the
  deal list right away, with the photos. Up to 4 photos; "Rewrite with AI" drafts again with all
  of them and any notes. The AI only uses what it can see or what the notes say, and the price is
  always the admin's. Without `ANTHROPIC_API_KEY` the page still works, but the admin writes the ad.
- **Share kit** (admin deal page): the social media post with the deal link, a copy button and
  share buttons (WhatsApp, Facebook, Telegram, X, email). The public deal page and the "You're
  in!" page have the same share buttons, so buyers can bring friends.
- **The fun bits**: category chips, "🔥 Almost there", "⏰ Ends soon" and "✨ New" badges, a rocket on
  the progress bar, countdown tiles, and confetti when someone joins, when a deal goes live and
  when a deal reaches its minimum while the page is open. Animations are off for visitors whose
  device asks for reduced motion.
- **Write with AI** (admin, New deal form): drafts the product description from the name, the
  notes typed in the description box and up to 4 of the chosen photos (shrunk to 1024 px in the
  browser). It only uses facts from those inputs and fills the form; the admin edits the draft
  before creating the deal. Uses the same `ANTHROPIC_API_KEY`.
- **Import products** (admin, `/admin/import`): upload a CSV file of products from another shop
  and turn them into deals.
  - **Formats:** a Shopify product export (rows grouped by Handle, with variants and extra
    images), a WooCommerce product export (variations are folded into their parent product), or
    any spreadsheet saved as CSV with a header row. Commas, semicolons and tabs all work, and so do
    UTF-8 and old Excel encodings. The spreadsheet needs a name column ("name", "title" or
    "product"). It can also have price, description, headline, category, min_buyers, days and image
    URL columns; **Download the template** on the import page shows them.
  - **Options:** a group discount (% off the file's price), and the minimum buyers, the number of
    days the deals run and the category for rows that don't set them. HTML descriptions become
    plain paragraphs. The category is worked out from the other shop's category, type and tags.
  - **Preview first:** every product is listed with its name, price, minimum and category, which
    can all be changed. Products already in the shop, without a price, or unpublished in the other
    shop start unticked. Only the ticked ones are published, as open deals. The preview is kept in
    the database for 6 hours and can be published once.
  - **Photos:** up to 8 per product (4 by default) are copied from the other site into
    `UPLOAD_DIR` in the background, a few at a time. Only public addresses are fetched, and the
    importer accepts only JPG, PNG, WebP or GIF files of up to 8 MB. Until a deal's photos are
    copied, or if copying fails, the deal shows the first photo from the other site. The import
    page shows the progress and any photos that failed.
  - **Limits:** up to 300 products and 5 MB per file. Products with sizes or colours become one
    deal with one price (the first variant's on Shopify, the lowest on WooCommerce). Imported deals
    are translated when a visitor first opens them in another language, so a large import doesn't
    use up the day's translation budget.

## Setup

```bash
npm install
cp .env.example .env   # fill in test keys, ADMIN_PASSWORD, APP_SECRET, business details
stripe listen --forward-to localhost:3000/webhooks/stripe \
  --events setup_intent.succeeded,payment_intent.succeeded,payment_intent.processing,payment_intent.payment_failed
npm start              # http://localhost:3000, admin at /admin (needs Node.js 22.13+)
```

In the Stripe Dashboard (test mode):

- Enable Cards, SEPA Direct Debit and iDEAL under Settings → Payment methods.
- Under Settings → Tax, set your origin address and add test registrations. Without
  registrations, VAT comes back as 0.

Scheduling: an in-process timer runs the scheduler every minute. On serverless hosting, set
`SCHEDULER_INTERVAL_MS=0` and call `POST /api/cron/tick` with
`Authorization: Bearer $CRON_SECRET` every minute instead.

Email: without `SMTP_URL`, emails are printed to the console. Either way, every email is kept
in the admin outbox (`/admin/emails`).

## Deploying

- **Hostinger** (web hosting or VPS): follow [`docs/DEPLOY_HOSTINGER.md`](docs/DEPLOY_HOSTINGER.md).
  `npm run package` builds the upload ZIP.
- **On web hosting the app is stopped when idle.** An hPanel cron job must call
  `POST /api/cron/tick` every minute, and the database must live outside the app folder.
- **Other hosts** need four things:
  - a long-running Node.js 22.13+ process (`npm start`, entry `src/start.js`; on Hostinger's
    Node.js web apps use `app.cjs`, which loads the same app for runners that `require()` the entry)
  - HTTPS in front of it
  - a persistent `DATABASE_PATH`
  - a Stripe webhook to `https://<domain>/webhooks/stripe`
- **Operations endpoints:**
  - `GET /healthz` for uptime checks
  - `POST /api/cron/backup` for rotated database copies
  - **Admin → Download database backup** for off-site copies

## Testing

- `npm test` runs the scenarios against an in-memory fake of the Stripe API with a controllable
  clock (`test/support/fakeStripe.js`).
- [`docs/TEST_CHECKLIST.md`](docs/TEST_CHECKLIST.md) is the manual checklist for a real Stripe
  test account. It covers the deal filling, the deal failing, a declined card and an SCA
  challenge. Admin "test-mode tools" move the deadline and the 48-hour window forward so the
  checklist takes minutes.

## Before going live (not done here)

- Have the terms and privacy policy reviewed. Complete every `[bracketed]` placeholder:
  delivery costs and times, return costs, governing law, processors, retention.
- Confirm the SEPA pre-notification wording and timing with Stripe and your lawyer.
- Configure Stripe Tax registrations for the countries where you must collect VAT (OSS).
- Remove the test-key guard deliberately, and the admin test-mode tools with it.
- Use a real email provider (ideally EU-hosted) and back up the SQLite file. SQLite and the
  in-memory join rate limit (`JOIN_RATE_LIMIT` per IP per 15 minutes) assume a single app
  instance.
- Decide how long to keep abandoned joins and Stripe Customer records, and match that in the
  privacy policy. Nothing purges them automatically yet.
