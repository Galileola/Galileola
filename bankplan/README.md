# Business plan for the bank (working name: bankplan)

Helps small businesses in Estonia write a bank-ready business plan.
Planning tool only, not legal, tax or financial advice.

**Status:** Phase 2 done: financial calculator with Estonian rules (3-year forecast, loan schedule, bank ratios) and a screen to enter the numbers.
Phase 1: login by email link, Estonian/Russian/English, plan list, empty wizard (11 sections), settings with "delete my account".
A full guide for non-developers comes in Phase 6.

## What is where

| Folder | What it holds |
|---|---|
| `src/config/countries/ee.ts` | All Estonian tax rules and bank benchmarks, each with source and check date |
| `src/lib/finance/` | The calculator (no screens, no database) and its tests in `__tests__/` |
| `src/plan-types/bank-loan/` | The wizard sections |
| `src/messages/` | All interface text (`et.json`, `ru.json`, `en.json`) |
| `src/app/[locale]/` | The pages |
| `supabase/migrations/` | Database tables and access rules |
| `docs/` | Phase reports |

## Run on a computer (for developers)

1. Install Node.js 22 or newer.
2. Copy `.env.example` to `.env.local` and fill in the Supabase project URL and publishable key.
3. Run:

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

Checks: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
