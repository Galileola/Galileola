# Plaani Äri

A web app that helps small businesses in Estonia write the business plan they give to a bank with a loan application.
The name **Plaani Äri** is shown in the page header and browser tab (key `app.name` in `src/messages/*.json`).
It is a planning tool only, not legal, tax or financial advice.

**What it does**

1. **Guided plan.** 11 sections with simple questions. An AI helper turns rough answers into clear text in Estonian, Russian or English.
2. **Numbers with Estonian rules.** A 3-year forecast (monthly for year 1), the loan schedule, the balance sheet and the ratios banks check (DSCR, break-even and others), for an OÜ or an FIE.
3. **Bank officer check.** A readiness score out of 100, the weak points, and the 10 hardest questions a credit officer would ask. Your answers are rated and the score updates.
4. **Download.** The whole plan as a Word or PDF file, in any of the three languages.

All Estonian tax rules and bank benchmarks are in one file, each with its source and the date it was checked: `src/config/countries/ee.ts`.

---

## Guide for the owner (no programming needed)

### The services behind the app

| Service | What it does | Where |
|---|---|---|
| **GitHub** | Keeps the code. Every change is saved here. | github.com |
| **Hostinger** | Runs the app on the internet (your Business Web Hosting plan, Node.js app). Test address: https://classic-indigo-gaur-55.hostingersite.com | Your Hostinger server (check its location in hPanel) |
| **Supabase** | Login by email link and the database with the plans. | Frankfurt, Germany (project "bankplan") |
| **Anthropic** | The AI (Claude). Used only when someone presses an AI button. | USA |

### Settings on Hostinger (hPanel → the website → Node.js → Environment variables)

| Name | What to put there | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | The Supabase project address | No |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The Supabase publishable key | No (made for the browser) |
| `ANTHROPIC_API_KEY` | Your Anthropic API key (console.anthropic.com → API keys) | **Yes.** Never put it in the code or in a chat. |
| `ANTHROPIC_MODEL` | The Claude model ID to use | No |
| `AI_DAILY_LIMIT_PER_USER` | AI requests one person may make per day. Optional, default 60. | No |
| `SITE_OPERATOR_NAME` | Who runs the service (person or company), shown on the privacy page | No |
| `SITE_CONTACT_EMAIL` | Contact email shown on the privacy page | No |

Saving a setting restarts the app. The two `NEXT_PUBLIC_…` values are built into the app, so changing them needs a new upload (see "Publishing a new version").

**Careful:** the AI key is entered only in hPanel. Settings changed through Hostinger's API replace the whole list, so whoever changes settings that way must enter the AI key again afterwards.

### Supabase login settings (one time)

In the Supabase dashboard: **Authentication → URL Configuration**

- **Site URL:** the app's address, now `https://classic-indigo-gaur-55.hostingersite.com`
- **Redirect URLs:** add `https://classic-indigo-gaur-55.hostingersite.com/**`

When the app moves to your own domain, change both to the new address.

Without this, the login link in the email leads to the wrong place.

### Login emails: test version vs. real launch

Until you set up your own email sending, Supabase's built-in email service:
- sends login emails **only to the members of your Supabase team** (your own address works), and
- sends only **a few emails per hour** for the whole app.

For real users, connect your own email sending service in **Supabase → Authentication → Emails → SMTP Settings** (any email provider that offers "SMTP", ideally one based in the EU).

### Publishing a new version

Hostinger's server cannot build this app itself (its system libraries are older than the Next.js build tools need).
So a new version is built on another computer and uploaded as a ready-made app:

1. On a computer with Node.js 22 and the `.env.local` file: run `./scripts/pack-hostinger.sh`. It creates `plaani-<version>.zip`.
2. Upload the zip to the website (hPanel → Files, or Hostinger's API) and start a Node.js deployment with
   application type **Express**, entry file **server.js**, Node.js **22**, no build command.
3. Hostinger installs the packages and restarts the app (about 1 minute).

Automatic publishing on every GitHub change is not set up, because Hostinger would try to build the app on its server and fail.

### Everyday tasks

**A tax rate or bank rule changes.** Open `src/config/countries/ee.ts` on GitHub, click the pencil icon, change the value, the `checked` date and the source, then click **Commit changes**. Then publish a new version (see "Publishing a new version"). The automated tests contain hand-calculated examples with the current rates, so after a rate change some tests will fail on purpose: ask a developer to recalculate them.

**Values to check every year (each January):**
- Social tax minimum monthly base for 2027 (946 € is *assumed* until the 2027 State Budget Act is published).
- Minimum wage (it changed on 1 April in 2026).
- Unemployment insurance rates (set until the end of 2029).
- VAT rates and the VAT registration threshold.
- The bank benchmarks (EIS, LHV, Coop Pank pages).

Values that are not confirmed are marked `assumed` in the config file and are listed in Appendix A of every downloaded plan.

**Change a text on the screen.** The texts are in `src/messages/et.json`, `ru.json` and `en.json`. Change the same key in all three files.

**Keep the AI bill under control.**
- Set a monthly spending limit in the Anthropic console (console.anthropic.com → Billing / Limits).
- Lower `AI_DAILY_LIMIT_PER_USER` in the Hostinger settings if needed.
- Rough cost per action at today's prices: writing one section ≈ 1–3 cents; one bank officer check ≈ 10–30 cents; rating the answers ≈ 5–15 cents; translating one section ≈ 2–5 cents. Check the real numbers in the Anthropic console.

**Someone asks you to delete their data.** They can do it themselves: **Settings → Delete my account** removes the account and all plans. You can also delete a user in **Supabase → Authentication → Users**.

### Free plans and their limits

- **Hostinger Business Web Hosting** (your existing paid plan) runs the app; business use is fine.
- **Supabase Free** pauses a project after about 7 days with little activity (you get an email first). Restore it in the Supabase dashboard with **Resume project**. Paid plans are never paused.
- **Anthropic** is pay-as-you-go.

### Before a real launch

- [ ] Own email sending in Supabase (see above).
- [ ] `SITE_OPERATOR_NAME` and `SITE_CONTACT_EMAIL` set, and the privacy text checked by a lawyer.
- [ ] Terms of use page (not built yet).
- [ ] Spending limit in the Anthropic console.
- [ ] Your own web address (domain) for Plaani Äri.
- [ ] Tax values re-checked for the new year.
- [ ] A test with a few real users and real AI answers.

---

## Status

- **Phase 6:** error pages, a daily AI limit per user, clearer login messages, security headers, privacy page, Frankfurt hosting region, this guide.
- **Phase 5:** bank officer check with readiness score (plan check 60 points + AI interview 40 points).
- **Phase 4:** download as Word and PDF in Estonian, Russian or English; AI translation of sections.
- **Phase 3:** questions for all 11 sections and the AI writing helper.
- **Phase 2:** financial calculator with Estonian rules and hand-calculated tests.
- **Phase 1:** login by email link, three languages, plan list, settings with "delete my account".

## For developers

### What is where

| Folder | What it holds |
|---|---|
| `src/config/countries/ee.ts` | All Estonian tax rules and bank benchmarks, each with source and check date |
| `src/lib/finance/` | The calculator (no screens, no database) and its tests in `__tests__/` |
| `src/plan-types/bank-loan/` | The wizard sections and their questions |
| `src/lib/ai/` | The AI helper: prompts and the one call to Claude (server only, with the daily limit) |
| `src/lib/review/` | The readiness score and the saved bank officer check |
| `src/lib/export/` | The downloadable plan: one document description, drawn as Word and as PDF |
| `src/assets/fonts/` | Noto Sans font for the PDF (Estonian and Russian letters), free licence |
| `src/messages/` | All interface text (`et.json`, `ru.json`, `en.json`) |
| `src/app/[locale]/` | The pages |
| `src/app/api/plans/[id]/export/` | The file download (Word or PDF) |
| `supabase/migrations/` | Database tables, access rules and functions |
| `docs/` | Phase reports |

### Run on a computer

1. Install Node.js 22 or newer.
2. Copy `.env.example` to `.env.local` and fill in the values (see the settings table above).
3. Run:

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

Checks: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

### Hosting notes

- `next.config.ts` builds a standalone server (`output: "standalone"`); `scripts/pack-hostinger.sh` packs it for Hostinger
  and turns the build's hashed package links into small packages, because links do not survive the upload.
- Hostinger runs `npm install` and then `server.js` (Node.js 22, through Passenger).
- The bank officer page asks for up to 300 seconds per request (`maxDuration`); how long Hostinger lets a request run
  is checked with the first real AI test.
