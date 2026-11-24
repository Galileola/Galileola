# Phase 0 — Estonian rules, sources, stack and folder plan

Checked on **24 November 2026**. All numbers are in one file:
[`src/config/countries/ee.ts`](../src/config/countries/ee.ts). Each value there has its source link and check date.

## 1. Can the rules be confirmed from official sources?

Yes, for everything the calculator needs in 2026, and for most of 2027–2029.
Sources used: the acts on Riigi Teataja (current text, plus the versions already published for 1 January 2027), the Tax and Customs Board (EMTA), Enterprise Estonia (EIS, which took over KredEx), and the banks' own pages.

### Taxes (company OÜ and sole proprietor FIE)

| What | Value | Where it comes from | Sure? |
|---|---|---|---|
| Income tax on wages | 22% | TuMS § 4 lg 1; unchanged in the 2027 version | Law |
| Tax-free income | 700 €/month, 8 400 €/year, flat for everyone (the "tax hump" ended in 2026) | TuMS § 23 lg 1; EMTA | Law |
| Social tax (employer) | 33% | SMS § 7 lg 1 | Law |
| Social tax minimum monthly base | 886 € in 2026 | 2026 State Budget, via EMTA | Official |
| Unemployment insurance | employee 1.6%, employer 0.8%, fixed for 2026–2029 | Government regulation no 78 of 25.09.2025 | Law |
| Funded pension (II pillar) | 2% default; person may choose 4% or 6%; withheld from the employee | KoPS § 9 | Law |
| Minimum wage | 886 € until March 2026, **946 € from 1 April 2026** | EMTA table of government regulations | Official |
| Company profit tax | 0% while profit stays in the company; 22/78 of the net dividend when paid out | TuMS § 4, § 50 | Law |
| Old 14% rate for regular dividends | Gone since 1 January 2025 | EMTA | Official |
| Tax for the owner on an Estonian dividend | none extra | TuMS § 18 lg 1 | Law |
| 2% "security tax" | Never introduced (not on wages, not on company profit) | EMTA, 2026 changes | Official |
| VAT | 24% standard (since 1 July 2025); 13%, 9%, 0% reduced | KMS § 15; unchanged in the 2027 version | Law |
| VAT registration | required above 40 000 € taxable turnover a year | KMS § 19 lg 1 | Law |
| FIE social tax | 33% of profit; at least 12 × monthly base a year (paid quarterly); at most on 10 × each month's minimum wage (max 36 867.60 € in 2026) | SMS § 2 lg 1 p 5, lg 5; EMTA FIE guide | Law |
| FIE income tax | 22% of profit ÷ 1.33 (this deducts the FIE's own social tax) | TuMS § 14 lg 5³–5⁵ | Law |
| FIE unemployment insurance | none on own income | EMTA | Official |
| FIE funded pension | 2/4/6% of taxable income if joined, same 10 × minimum wage cap | EMTA FIE guide | Official |
| Payment days | payroll taxes by the 10th of next month; VAT return by the 20th | SMS § 9, TuMS § 40, KMS § 27 | Law |

"Law" = I read it in the act. "Official" = stated by EMTA or EIS, not checked in an act.

One correction to common belief: the FIE social tax cap is **10 ×** the minimum wage (SMS § 2 lg 1 p 5), not 15 ×.

### What I could NOT confirm (marked `assumed` in the config)

1. **Social tax minimum base for 2027.** The 2027 State Budget Act is not adopted yet. The law says it can't be lower than the minimum wage on 1 July 2026, which is 946 €. I put 946 € and marked it as an assumption.
2. **Minimum wage for 2027 and later.** Not set yet. This affects only the FIE social tax cap. The app will reuse the last known value and show a warning.
3. **Unemployment insurance after 2029.** Fixed only until 2029. Outside our 3-year horizon for now.
4. **Exact VAT and dividend-tax payment days.** The law text I checked names the day the return is due (20th and 10th). I assume payment happens the same day.
5. **Luminor.** Its website is blocked from my work environment, so I did not read its loan terms. I did not use any Luminor numbers.
6. **Pension-age tax-free income (776 €/month).** Stated by EMTA; I did not find it in the act. Not important for business plans.

Not included on purpose: the "ettevõtluskonto" (simplified business account, 20% tax). It is a third business form; tell me if you want it later.

## 2. What Estonian banks ask for

No bank publishes its full credit rules. The public evidence:

- **Plan contents (EIS minimum list):** business idea; investments needed, their cost and how they are paid for; future customers; suppliers; competitors (and their finances if possible); staff; key people's skills and experience, with CVs; financial forecasts for the **next three years**; past annual reports and a recent interim report; existing debts; licences.
- **SEB adds:** a summary page, market and competitors, risks *with how you reduce them*, marketing and sales, an action plan for the coming months, and a **scenario analysis** ("what if I sell less?"). SEB lists typical mistakes: overestimating income, underestimating costs, expecting big profit in year 1.
- **Financial format (EIS template):** cash flow **monthly for year 1, then yearly**; income statement and **balance sheet** yearly; a summary table of key figures.
- **Ratios (EIS loan guarantee):** debt service coverage (DSCR) **at least 1.2** after the loan; current ratio at least 1.1; equity at least 20% of the balance sheet.
- **Own contribution (examples):** LHV investment loan 30% of the loan (or extra collateral); Coop Pank finances up to 80% of the project (so 20% own money); EIS starter loan recommended at least 10%; LHV micro loan (5 000–50 000 €) 0% and no collateral.
- **Collateral:** mortgage on real estate; guarantee from the owner or board member; EIS guarantee up to 80% of the loan (60% in construction), yearly fee 0.8–3.8%. Swedbank: average interest around 9% + Euribor with a guarantee, around 3.5% + Euribor with a mortgage.
- **Documents:** last annual report; balance sheet and income statement not older than 2 months (LHV, Coop) or 12 months (Swedbank); valuation of real estate by a bank-approved appraiser.

### Your question: how detailed should the projection be?

Answer from the evidence: **monthly for year 1, yearly for years 2 and 3**, as in the EIS template. The loan repayment schedule runs for the full loan term.

**One addition I recommend:** a simple yearly **balance sheet**. Without it the app can't check two of the three EIS ratios (equity share and current ratio). See question 1 below.

## 3. Proposed stack

Your stack is a good fit. I suggest no big changes, only these choices inside it:

| Need | Choice | Why |
|---|---|---|
| Web app | Next.js (App Router) + TypeScript + Tailwind | As you asked |
| Login + database | Supabase, **EU region (Frankfurt)**, email link login, row-level security so each user sees only their own plans | GDPR, simple login |
| Hosting | Vercel, server functions in the Frankfurt region | Keeps processing in the EU |
| AI | Claude API through Anthropic's official TypeScript SDK, called only from the server; key in an environment variable; model name in an environment variable too, so it can be changed without code changes | Key never reaches the browser |
| Languages | `next-intl`, Estonian default, Russian, English | Works well with Next.js App Router |
| Word export | `docx` library | Real Word files, no conversion |
| PDF export | `@react-pdf/renderer` | Runs on Vercel without a headless browser |
| Input checks | `zod` | One set of rules for forms and server |
| Tests | Vitest | Fast; calculator tests with hand-calculated examples |

### GDPR plan

- We store: email (for login) and the plan content. No ID code, no address, no phone.
- "Delete my account and all my data" button in settings. It deletes plans and the login.
- Logs contain error codes and request IDs only, never plan text or emails.
- AI calls send the plan text (not the email) to Anthropic. The privacy notice will say so.
- Disclaimer on every page footer and in every export: *planning tool, not legal, tax or financial advice*.

## 4. Proposed folder structure

The app goes in a new folder `bankplan/` in this repository, next to the existing `speak-power` app.

```
bankplan/
  docs/phase-0-report.md        this report
  src/
    config/
      types.ts                  shapes for rule files (value + source + date)
      countries/ee.ts           ALL Estonian numbers and sources (one file)
    plan-types/
      bank-loan/                wizard sections and questions as data
    lib/
      finance/                  the calculator: plain functions, no UI, no database
        __tests__/              hand-calculated test cases
      ai/                       prompts and the Claude call (server only)
      export/                   one document model -> .docx and .pdf
      supabase/                 database helpers
    app/[locale]/               pages: login, plans, wizard, numbers, bank review, export
    messages/                   et.json, ru.json, en.json (all interface text)
  supabase/migrations/          tables and access rules
```

How later expansion works:

- **Another country** (e.g. Latvia): add `config/countries/lv.ts` and a tax module `lib/finance/tax/lv.ts`. The wizard, export and AI parts stay the same.
- **Another plan type** (e.g. EU grant): add `plan-types/eu-grant/` with its own sections. The calculator and export are shared.

## 5. Questions for you

1. **Balance sheet:** may I add a simple yearly balance sheet to the calculator (Phase 2)? Banks and EIS use it for two of their three key ratios. *Recommended: yes.*
2. **Start of the forecast:** the user picks the first month (any month), then 12 months + 2 full years follow. *Recommended: yes.*
3. **Assumed values:** when a 2027+ value is not confirmed yet, the app uses the last known value and shows a small "assumption" label next to the result and in the export appendix. *Recommended: yes.*
4. **App name:** I use the working name `bankplan` for the folder. Do you have a product name for the interface?
