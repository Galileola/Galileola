# Group Buy (EU)

A group-buying site for the EU market. Buyers save a payment method when they join a deal. They
are charged only if the deal reaches its minimum number of buyers before the deadline.

**Stripe test mode by default.** The app refuses to start unless both Stripe keys are test-mode
keys, and it rejects live-mode webhook events. Real payments are a deliberate switch,
`PAYMENTS_MODE=live` (see [Going live](#going-live)). Even then, the shop pauses new orders until
the company details and legal pages are complete.

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
- **Shipping**: on the deal page the admin marks paid orders as shipped, one at a time with a
  tracking number and link, many at once by pasting "order number, tracking number, link" lines
  from a spreadsheet, or all at once without tracking. Each buyer gets a "your order is on its way"
  email in their language. The order list (CSV) includes the shipping date and tracking.
- **Messages to buyers**: the admin writes one email to everyone in a deal or only to paid orders
  (a delivery date, a delay, pick-up details). With the AI switched on it is translated into each
  buyer's language; otherwise it is sent as written.
- **Withdrawal (EU 14-day right)**: an admin action. Uncharged buyers are released; paid buyers
  get a full refund and a Stripe Tax reversal.
- **Legal pages**: `/terms` (when payment is taken, the 48-hour rule, the withdrawal right and
  the model form), `/privacy` (GDPR) and `/cookies`. Estonian, Finnish, Latvian and Russian
  visitors read built-in translations (`views/legal/*-body.<lang>.ejs`) while the English text is
  the built-in one; the admin's legal page editor starts from them. Stripe.js only loads on
  payment pages.
- **Online withdrawal function** (Article 11a of Directive 2011/83/EU, as amended by Directive
  (EU) 2023/2673; applies since 19 June 2026): "Withdraw from contract here" is in the footer of
  every page, on the buyer's order page and in the joined and paid emails. `/withdraw` asks for the
  order, the buyer's name and an email address, and ends with "Confirm withdrawal". The buyer is
  emailed an acknowledgement at once, with what they sent and the date and time; the shop gets a
  copy. Opened from the buyer's own link, an order that hasn't been charged is cancelled
  automatically. Paid orders, payments in progress and requests from the general link (where
  anyone could type someone else's email) wait in Admin → Withdrawals, which refunds in full
  (and reverses the VAT record) with one button. The terms describe it in every language.
- **Phone number**: Admin → Settings → Shop details (or `BUSINESS_PHONE`). EU consumer law asks
  for it next to the address and email; it is shown in the footer, the terms (including the
  withdrawal instructions) and the emails, and the go-live checklist requires it.
- **Cookie notice**: the shop sets only necessary cookies (consent choice, chosen language,
  Stripe's fraud prevention on payment pages), so the notice only informs, with one "OK" button.
  Optional cookies go in `src/cookies.js`; once that list has one, the notice offers "Only
  necessary" and "Accept all", and the cookie must wait for `window.gbConsent.allows('optional')`.
  Visit counting (Admin → Performance) uses no cookies.
- **Product photos**: the admin uploads up to 8 photos per deal (JPG, PNG, WebP or GIF, 8 MB
  each) when creating it or later on the deal page, picks the cover, changes the order with the
  arrows and can describe each photo (for screen readers and search engines; the product name is
  used otherwise). With [sharp](https://sharp.pixelplumbing.com) installed (an optional
  dependency that `npm install` adds on Linux, macOS and Windows), each photo is stored as a
  JPEG of at most 1600 px plus a 480 px WebP thumbnail. It is turned the right way up, and its
  camera data and GPS location are removed. Older photos get these copies in the background at
  startup; their original files stay. Without sharp, the originals are used as they are. On the
  deal page shoppers swipe through the photos (arrows on a computer) and tap one to see it full
  screen. The type is checked
  from the file contents. Files go to `UPLOAD_DIR` (default: `uploads` next to the database,
  so keep `DATABASE_PATH` outside the app folder) and are served at `/uploads/<random name>`.
  They aren't in the database backups: copy that folder too.
- **AI shopping assistant**: a chat window on the public pages, answered by Claude
  (`claude-opus-5-5` at low effort) from the open deals and the shop's rules. It has no tools,
  can't see orders or payments, and the conversation stays in the visitor's browser tab. It
  stays off until `ANTHROPIC_API_KEY` is set; `ASSISTANT_RATE_LIMIT` and
  `ASSISTANT_DAILY_LIMIT` cap usage. If the model declines a message, the API's server-side
  fallback answers on another model.
- **Languages** (Admin → Settings → Languages): tick which of the 25 languages the shop offers.
  Only those appear in the language menu (hidden when there is only one), the sitemap and search
  engines' language links, the browser's language is matched against them (anything else gets the
  shop's main language), and new deals are translated only into them. The main language,
  `CONTENT_LANGUAGE` (Estonian unless set), is always on: deals are written in it, and the AI deal
  writer writes in it. English can be switched off; the admin stays in English. "Only Estonian"
  makes an Estonian-only shop. Every dictionary stays in the code, so a language can be switched on
  again at any time; category names typed for a language that is off are kept. Until the page is
  saved, all 25 are offered. The go-live check looks at the legal text visitors see in each offered
  language, so an Estonian-only shop needs complete Estonian legal pages.
- **Delivery countries** (Admin → Settings → Delivery countries): switch each EU country on or
  off. Only the countries switched on are in the order form (with one, it is already picked), a
  form posted with another country is refused, and the shopping assistant names them. Until the
  page is saved, `DELIVERY_COUNTRIES` applies (comma-separated codes, default `EE`: Estonia only).
  Buyers who already joined keep their orders.
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
- **Branding & search** (admin, Settings → Branding & search):
  - the shop name (the company name from Shop details is used until one is set)
  - a logo, shown in the header and also made into the browser-tab icon and the app icon for
    phones' home screens
  - the picture shown when a link to the shop is shared (deal pages use their own photo)
  - the home page's title and description in search results (in the shop's main language)
  - the verification codes for Google Search Console and Bing Webmaster Tools

  Without any of these the shop uses its standard icon and a standard share picture. Every page
  links a web app manifest (`/manifest.webmanifest`), so phones can add the shop to the home
  screen. The home page describes the shop and its deal search for search engines (schema.org).
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

- **Deal search**: a search box above the deals finds them by name, headline, description and
  category, in the visitor's language or the original, ignoring case and accents. Search result
  pages are kept out of search engines.
- **Deal alerts**: under the deals, shoppers leave their email address to hear about new deals.
  - **Sign-up:** double opt-in. Nothing is sent until they confirm with the link in the first
    email (in their language). Unconfirmed sign-ups are deleted after 30 days. Bots are caught
    by a hidden field and a limit of 5 sign-ups per address per 15 minutes.
  - **Sending:** on an open deal's admin page, "Email it to N subscribers" sends the deal to
    everyone confirmed, in their language.
  - **Unsubscribing:** every alert has an unsubscribe link and the one-click unsubscribe
    headers that Gmail and Apple Mail show.
  - **Admin list:** Admin → Customers → Deal alert subscribers lists and exports the subscribers.
  - **Privacy policy:** the template now describes deal alerts and when unused data is removed.
- **Customers** (admin): everyone who has joined a deal, by email address, with their sign-ups,
  paid orders and amount paid; a search by name, email or city; and a CSV download. A customer's
  page lists their orders and erases their data on request (GDPR Art. 17): sign-ups that never
  led to a payment are anonymised and their Stripe customer record is deleted, while paid orders
  are kept for the accounting and tax records.
- **Data that is no longer needed**: sign-ups that were never charged (the deal didn't go ahead,
  the buyer withdrew before paying or never finished joining) are anonymised automatically 30
  days after they ended (checked hourly by the scheduler). Mention this in your privacy policy.
- **Admin login**: `/admin` opens a login page (user name and password). A login lasts 12
  hours, or 30 days when "Keep me logged in" is ticked. **🚪 Log out** in the admin menu ends it
  on the server as well as in the browser, so a copied login cookie stops working too. Changing
  the password (in the admin or with a new `ADMIN_PASSWORD`) logs out every other device. After
  10 wrong passwords from one address in 15 minutes, that address is refused for 15 minutes.
- **Forgot your password?** (admin login page): emails a link to choose a new password to
  `ADMIN_EMAIL`, or else to the customer contact email. The link works once, for 30 minutes,
  and only the newest one works; the outbox keeps the email without the link. At most 3 emails
  per visitor every 15 minutes. Two-step login still asks for the code afterwards. Without
  email (`SMTP_URL`), the page explains the other way: a new `ADMIN_PASSWORD` in the hosting
  panel.
- **Two-step login** (Admin → Settings → Two-step login): after the password, the admin asks
  for a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator,
  1Password, Bitwarden, Authy …). It uses the standard TOTP codes (RFC 6238).
  - **Setting it up:** scan a QR code, then type the first code to confirm. You get 10 one-time
    backup codes for when the phone isn't at hand.
  - **Remembering a device:** a passed code is remembered on that device for 12 hours, or for
    30 days when "Remember this device" is ticked. Log out forgets it on that device too.
  - **Protection:** each code works once, and 5 wrong codes in 15 minutes lock that address
    out for 15 minutes.
  - **Changes:** turning it off or making new backup codes needs a current code.
  - **Locked out?** If both the phone and the backup codes are lost, set `ADMIN_TWO_STEP=off`
    in the hosting panel and restart. The password alone then works until you turn two-step
    login on again.
- **Photo backup**: Admin → Download photos (ZIP) downloads every product photo and logo; the
  database backup doesn't include them.

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

## Going live

Admin → Settings → **Go-live checklist** shows what is ready and what is still missing.

1. **Company details:** fill in every field under Admin → Settings → Shop details.
2. **Legal pages:** write your own terms, privacy policy and cookie page under Admin → Settings →
   Legal pages (start from the built-in text). Complete every `[bracketed]` placeholder:
   delivery costs and times, return costs, dispute resolution, processors and retention. Have
   a lawyer review them, and confirm the SEPA pre-notification wording and timing with Stripe.
3. **Email:** set `SMTP_URL` to a real email provider (ideally EU-hosted). Check that Admin →
   Emails says "delivered".
4. **Stripe, in live mode:**
   - turn on Cards, SEPA Direct Debit and iDEAL
   - add your VAT registrations (OSS) under Settings → Tax
   - create a webhook to `https://<your domain>/webhooks/stripe` with the events listed in Setup
5. **Switch on real payments:** in the hosting panel, set these, then restart the app:
   - `PAYMENTS_MODE=live`
   - `STRIPE_SECRET_KEY=sk_live_…` (or a restricted `rk_live_…` key)
   - `STRIPE_PUBLISHABLE_KEY=pk_live_…`
   - `STRIPE_WEBHOOK_SECRET` from the live webhook

   The app refuses to start in live mode without live keys, the webhook secret and `SMTP_URL`.

**What changes in live mode:**
- The yellow test banner and the admin test-mode tools disappear.
- Webhook events and Stripe objects from test mode are refused.
- Deal pages say "closed to new buyers" while any required checklist item is missing.

**Other things to keep in mind:**
- **Backups:** back up the SQLite file and the photos (Admin → Download photos).
- **One app instance:** SQLite and the in-memory rate limits assume a single app instance.
- **Privacy policy:** the built-in template says that sign-ups that never led to a payment are
  anonymised after 30 days, and how deal alerts work. Keep those points in your own version.
