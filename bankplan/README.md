# Business plan for the bank (working name: bankplan)

Helps small businesses in Estonia write a bank-ready business plan.
Planning tool only, not legal, tax or financial advice.

**Status:** Phase 4 done: download the plan as Word (.docx) and PDF in Estonian, Russian or English, with the numbers, the loan schedule and how the numbers were calculated. Sections written in another language can be translated by the AI.
Phase 3: questions for all 11 plan sections and an AI helper that turns rough answers into clear text (needs `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`).
Phase 2: financial calculator with Estonian rules (3-year forecast, loan schedule, bank ratios) and a screen to enter the numbers.
Phase 1: login by email link, Estonian/Russian/English, plan list, empty wizard (11 sections), settings with "delete my account".
A full guide for non-developers comes in Phase 6.

## What is where

| Folder | What it holds |
|---|---|
| `src/config/countries/ee.ts` | All Estonian tax rules and bank benchmarks, each with source and check date |
| `src/lib/finance/` | The calculator (no screens, no database) and its tests in `__tests__/` |
| `src/plan-types/bank-loan/` | The wizard sections and their questions |
| `src/lib/ai/` | The AI helper: prompts and the one call to Claude (server only) |
| `src/lib/export/` | The downloadable plan: one document description, drawn as Word and as PDF |
| `src/assets/fonts/` | Noto Sans font for the PDF (Estonian and Russian letters), free licence |
| `src/messages/` | All interface text (`et.json`, `ru.json`, `en.json`) |
| `src/app/[locale]/` | The pages |
| `src/app/api/plans/[id]/export/` | The file download (Word or PDF) |
| `supabase/migrations/` | Database tables and access rules |
| `docs/` | Phase reports |

## Run on a computer (for developers)

1. Install Node.js 22 or newer.
2. Copy `.env.example` to `.env.local` and fill in the Supabase project URL and publishable key, and the AI key and model.
3. Run:

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

Checks: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
