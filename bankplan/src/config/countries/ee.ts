/**
 * ESTONIA — all tax rules and bank benchmarks used by the app, in one place.
 *
 * Rules for editing this file:
 * - Every value needs at least one official source and the date it was checked.
 * - Never guess. If a value is not fixed yet, add it with certainty 'assumed'
 *   and say why in `note`. The app shows assumed values to the user.
 * - When a law changes, add a new period with the new `from` date. Do not
 *   overwrite old periods: plans made earlier must still calculate the same.
 *
 * Abbreviations of acts (all on Riigi Teataja):
 *   TuMS = Income Tax Act, SMS = Social Tax Act, KMS = Value-Added Tax Act,
 *   KoPS = Funded Pensions Act, TKindlS = Unemployment Insurance Act.
 *
 * Full review: 2026-11-24. See docs/phase-0-report.md for the notes behind each value.
 */
import type { Rule, Source, Sourced } from '../types';

const CHECKED = '2026-11-24';

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const rt = (act: string, ref: string): Source => ({
  url: `https://www.riigiteataja.ee/akt/${act}`,
  ref,
  checked: CHECKED,
});

/** Act versions already published for 1 January 2027 (checked to confirm nothing changes). */
const rt2027 = {
  TuMS: 'https://www.riigiteataja.ee/akt/121112026045',
  SMS: 'https://www.riigiteataja.ee/akt/121112026039',
  KMS: 'https://www.riigiteataja.ee/akt/130062026130',
};

const emta = {
  rates: {
    url: 'https://emta.ee/ariklient/maksud-ja-tasumine/tulumaks-ja-sotsiaalmaks/maksumaarad',
    checked: CHECKED,
  },
  changes2026: { url: 'https://emta.ee/uudised/maksumuudatused-2026', checked: CHECKED },
  socialTax: {
    url: 'https://emta.ee/ariklient/maksud-ja-tasumine/tulumaks-ja-sotsiaalmaks/sotsiaalmaks',
    checked: CHECKED,
  },
  unemployment: {
    url: 'https://emta.ee/ariklient/maksud-ja-tasumine/tulumaks-ja-sotsiaalmaks/tootuskindlustusmakse',
    checked: CHECKED,
  },
  /** EMTA guide "Füüsilisest isikust ettevõtja ABC" (PDF), sections updated 28.04.2026. */
  fieGuide: { url: 'https://www.emta.ee/node/125/main_chapter/10599/pdf', checked: CHECKED },
} satisfies Record<string, Source>;

const eis = {
  loanGuarantee: { url: 'https://eis.ee/en/services/laenukaendus/', checked: CHECKED },
  marketGuarantee: { url: 'https://eis.ee/en/services/turutingimustel-laenukaendus/', checked: CHECKED },
  /** Product closed on 31.12.2023. Its published criteria are still the clearest public benchmark. */
  starterLoan: { url: 'https://eis.ee/teenused/stardilaen-2/', checked: CHECKED },
  forecastTemplate: {
    url: 'https://eis.ee/wp-content/uploads/2023/10/finantsprognooside_tabel_2023-1.xlsx',
    checked: CHECKED,
  },
} satisfies Record<string, Source>;

const banks = {
  lhvInvestment: { url: 'https://www.lhv.ee/et/investeerimislaen', checked: CHECKED },
  lhvMicro: { url: 'https://www.lhv.ee/et/mikrolaen/', checked: CHECKED },
  swedbankLoan: {
    url: 'https://www.swedbank.ee/business/finance/capital/loan?language=EST',
    checked: CHECKED,
  },
  coopInvestment: { url: 'https://www.cooppank.ee/en/business/investment-loan', checked: CHECKED },
  sebBusinessPlan: {
    url: 'https://www.seb.ee/foorum/ettevotlusega-alustamine/oskuslikult-koostatud-ariplaan-loob-eelduse-labiloogiks',
    checked: CHECKED,
  },
} satisfies Record<string, Source>;

// ---------------------------------------------------------------------------
// Payroll (employees of an OÜ or of an FIE)
// ---------------------------------------------------------------------------

export const payroll = {
  incomeTaxRate: {
    label: 'Personal income tax withheld from wages',
    unit: 'rate',
    periods: [
      {
        from: '2025-01-01',
        value: 0.22,
        certainty: 'law',
        sources: [
          rt('TuMS', 'TuMS § 4 lg 1'),
          { url: rt2027.TuMS, ref: 'TuMS § 4 lg 1 (version in force from 01.01.2027)', checked: CHECKED },
          emta.rates,
        ],
        note: 'Same 22% in the version of the act in force from 01.01.2027. The planned rise to 24% and the 2% "security tax" were never introduced (EMTA, 2026 changes).',
      },
    ],
  },

  basicExemptionYearly: {
    label: 'Tax-free income (basic exemption) per person per year',
    unit: 'EUR/year',
    periods: [
      {
        from: '2026-01-01',
        value: 8400,
        certainty: 'law',
        sources: [rt('TuMS', 'TuMS § 23 lg 1'), emta.changes2026],
        note: 'Since 2026 it is a flat 700 EUR a month and no longer falls as income grows ("maksuküür" removed). Applied by one employer only, on the employee\'s written request. People of old-age pension age get 776 EUR a month (9312 a year) instead, stated by EMTA; not checked in the act.',
      },
    ],
  },

  basicExemptionMonthly: {
    label: 'Tax-free income per month (used in monthly payroll)',
    unit: 'EUR/month',
    periods: [
      {
        from: '2026-01-01',
        value: 700,
        certainty: 'official',
        sources: [emta.changes2026, emta.rates],
        note: 'Monthly share of the 8400 EUR yearly amount in TuMS § 23 lg 1.',
      },
    ],
  },

  socialTaxRate: {
    label: 'Social tax paid by the employer on gross wages',
    unit: 'rate',
    periods: [
      {
        from: '2001-01-01',
        value: 0.33,
        certainty: 'law',
        sources: [
          rt('SMS', 'SMS § 7 lg 1'),
          { url: rt2027.SMS, ref: 'SMS § 7 lg 1 (version in force from 01.01.2027)', checked: CHECKED },
          emta.rates,
        ],
      },
    ],
  },

  socialTaxMonthlyMinBase: {
    label: 'Social tax minimum monthly base ("sotsiaalmaksu kuumäär")',
    unit: 'EUR/month',
    periods: [
      {
        from: '2026-01-01',
        value: 886,
        certainty: 'official',
        sources: [emta.rates, emta.socialTax],
        note: 'Set by the 2026 State Budget Act. The employer pays social tax on at least this amount for a full-time employee (minimum 292.38 EUR a month), with exceptions in SMS § 2 lg 3.',
      },
      {
        from: '2027-01-01',
        value: 946,
        certainty: 'assumed',
        sources: [
          rt('SMS', 'SMS § 2¹ — the monthly base may not be lower than the minimum wage in force on 1 July of the year before'),
          emta.rates,
        ],
        note: 'NOT CONFIRMED. The 2027 State Budget Act was not adopted yet when checked. 946 EUR is the legal floor (minimum wage in force on 1 July 2026, see minimumWageMonthly). Update when the act is published.',
      },
    ],
    knownUntil: '2026-12-31',
  },

  unemploymentInsuranceEmployee: {
    label: 'Unemployment insurance withheld from the employee',
    unit: 'rate',
    periods: [
      {
        from: '2026-01-01',
        value: 0.016,
        certainty: 'law',
        sources: [
          {
            url: 'https://www.riigiteataja.ee/akt/130092025003',
            ref: 'Government regulation no 78 of 25.09.2025, § 1 lg 1 (rates for 2026–2029)',
            checked: CHECKED,
          },
          emta.unemployment,
        ],
        note: 'Not withheld from people of old-age pension age (TKindlS § 42).',
      },
    ],
    knownUntil: '2029-12-31',
  },

  unemploymentInsuranceEmployer: {
    label: 'Unemployment insurance paid by the employer',
    unit: 'rate',
    periods: [
      {
        from: '2026-01-01',
        value: 0.008,
        certainty: 'law',
        sources: [
          {
            url: 'https://www.riigiteataja.ee/akt/130092025003',
            ref: 'Government regulation no 78 of 25.09.2025, § 1 lg 2 (rates for 2026–2029)',
            checked: CHECKED,
          },
          emta.unemployment,
        ],
      },
    ],
    knownUntil: '2029-12-31',
  },

  fundedPensionDefaultRate: {
    label: 'Funded pension (II pillar) withheld from the employee, default rate',
    unit: 'rate',
    periods: [
      {
        from: '2024-01-01',
        value: 0.02,
        certainty: 'law',
        sources: [rt('KoPS', 'KoPS § 9 lg 1'), emta.rates],
        note: 'Only for people who joined the II pillar. It is withheld from the employee, so it does not change the employer\'s cost.',
      },
    ],
  },

  fundedPensionAllowedRates: {
    label: 'Funded pension rates a person can choose',
    unit: 'rate',
    periods: [
      {
        from: '2024-01-01',
        value: [0.02, 0.04, 0.06],
        certainty: 'law',
        sources: [rt('KoPS', 'KoPS § 9 lg 1–2'), emta.rates],
      },
    ],
  },

  minimumWageMonthly: {
    label: 'Minimum monthly wage for full-time work',
    unit: 'EUR/month',
    periods: [
      {
        from: '2025-01-01',
        value: 886,
        certainty: 'official',
        sources: [{ ...emta.rates, ref: 'Table "Töötasu alammäärad" — Government regulation no 87 of 19.12.2024' }],
      },
      {
        from: '2026-04-01',
        value: 946,
        certainty: 'official',
        sources: [{ ...emta.rates, ref: 'Table "Töötasu alammäärad" — Government regulation no 36 of 23.03.2026' }],
        note: 'Changed on 1 April 2026, not on 1 January.',
      },
    ],
    knownUntil: '2026-12-31',
  },
} satisfies Record<string, Rule<number> | Rule<number[]>>;

/** OÜ board member fee (juhatuse liikme tasu): differs from an employee's wage. */
export const boardMember = {
  unemploymentInsurance: {
    label: 'Unemployment insurance on a board member fee',
    value: false,
    certainty: 'law',
    sources: [rt('TKindlS', 'TKindlS § 3 lg 2 p 3 (a board member without an employment contract is not insured)')],
  },
  socialTaxMinimum: {
    label: 'Employer minimum social tax (monthly base) on a board member fee',
    value: false,
    certainty: 'law',
    sources: [rt('SMS', 'SMS § 2 lg 2 (minimum applies to employees and officials)')],
    note: 'Social tax 33%, funded pension and income tax still apply (SMS § 2 lg 1 p 4, KoPS § 7 lg 1).',
  },
} satisfies Record<string, Sourced<boolean>>;

/** How withheld income tax on a wage is worked out. */
export const wageIncomeTaxBase = {
  label: 'Income tax base for a monthly wage',
  value: 'gross − employee unemployment insurance − funded pension − monthly tax-free income',
  certainty: 'law',
  sources: [rt('TuMS', 'TuMS § 42 lg 1 (1/12 of the tax-free income), lg 5 (unemployment insurance), lg 6 (funded pension)')],
} satisfies Sourced<string>;

// ---------------------------------------------------------------------------
// Company (OÜ) profit tax — tax is paid when profit is distributed, not when it is earned
// ---------------------------------------------------------------------------

export const corporate = {
  distributionTaxRate: {
    label: 'Corporate income tax rate on distributed profit (dividends)',
    unit: 'rate',
    periods: [
      {
        from: '2025-01-01',
        value: 0.22,
        certainty: 'law',
        sources: [rt('TuMS', 'TuMS § 4 lg 1, § 50 lg 1'), emta.rates],
        note: 'Tax = net dividend × 22/78. The reduced 14/86 rate for regular dividends ended on 01.01.2025.',
      },
    ],
  },

  distributionGrossUpDivisor: {
    label: 'Divisor applied to the net distribution before the tax rate (22/78 formula)',
    unit: 'multiplier',
    periods: [
      {
        from: '2025-01-01',
        value: 0.78,
        certainty: 'law',
        sources: [rt('TuMS', 'TuMS § 4 lg 1¹')],
        note: 'Tax = net distribution / 0.78 × 0.22. Equals 1 − rate.',
      },
    ],
  },

  taxOnRetainedProfit: {
    label: 'Tax on profit that stays in the company',
    unit: 'rate',
    periods: [
      {
        from: '2025-01-01',
        value: 0,
        certainty: 'law',
        sources: [rt('TuMS', 'TuMS § 50 lg 1 — tax arises when profit is paid out'), emta.changes2026],
        note: 'The planned 2% security tax on company profit was not introduced ("Ettevõtte kasumile ei kehtestatud 2% julgeolekumaksu", EMTA).',
      },
    ],
  },

  dividendTaxForResidentOwner: {
    label: 'Extra income tax for an Estonian-resident person receiving a dividend from an Estonian OÜ',
    unit: 'rate',
    periods: [
      {
        from: '2025-01-01',
        value: 0,
        certainty: 'law',
        sources: [rt('TuMS', 'TuMS § 18 lg 1 (only dividends from foreign companies are taxed)'), emta.rates],
        note: 'Exception: dividends paid out of profit taxed at the old 14/86 rate (before 2025) carry 7% withholding (TuMS § 61 lg 68). Not modelled for new businesses.',
      },
    ],
  },
} satisfies Record<string, Rule<number>>;

// ---------------------------------------------------------------------------
// VAT
// ---------------------------------------------------------------------------

export const vat = {
  standardRate: {
    label: 'VAT standard rate',
    unit: 'rate',
    periods: [
      {
        from: '2025-07-01',
        value: 0.24,
        certainty: 'law',
        sources: [
          rt('KMS', 'KMS § 15 lg 1'),
          { url: rt2027.KMS, ref: 'KMS § 15 lg 1 (version in force from 01.01.2027)', checked: CHECKED },
          emta.rates,
        ],
      },
    ],
  },

  reducedRates: {
    label: 'VAT reduced rates',
    unit: 'rate',
    periods: [
      {
        from: '2025-07-01',
        value: [0.13, 0.09, 0],
        certainty: 'law',
        sources: [rt('KMS', 'KMS § 15 lg 1¹ (13% accommodation), lg 2 (9% books, press, medicines and others), lg 3–4 (0%)'), emta.rates],
        note: 'The wizard asks which rate applies to each product; it does not decide this for the user.',
      },
    ],
  },

  registrationThreshold: {
    label: 'Yearly taxable turnover in Estonia above which VAT registration is required',
    unit: 'EUR/year',
    periods: [
      {
        from: '2025-01-01',
        value: 40000,
        certainty: 'law',
        sources: [rt('KMS', 'KMS § 19 lg 1')],
      },
    ],
  },
} satisfies Record<string, Rule<number> | Rule<number[]>>;

// ---------------------------------------------------------------------------
// FIE (sole proprietor) — taxed once a year on business profit
// ---------------------------------------------------------------------------

export const soleProprietor = {
  socialTaxMinBaseMonths: {
    label: 'Minimum yearly social tax base, in months of the social tax monthly base',
    unit: 'months',
    periods: [
      {
        from: '2018-01-01',
        value: 12,
        certainty: 'law',
        sources: [rt('SMS', 'SMS § 2 lg 5'), emta.fieGuide],
        note: 'Paid in advance each quarter: 3 × monthly base × 33% (877.14 EUR per quarter in 2026). Exceptions (pensioners, people with reduced work ability, students, registration part-year) in SMS § 2 lg 5–8.',
      },
    ],
  },

  socialTaxMaxBaseMinimumWages: {
    label: 'Maximum yearly social tax base, as a multiple of each month\'s minimum wage',
    unit: 'multiplier',
    periods: [
      {
        from: '2018-01-01',
        value: 10,
        certainty: 'law',
        sources: [rt('SMS', 'SMS § 2 lg 1 p 5'), emta.fieGuide],
        note: 'Cap = 10 × sum of the 12 monthly minimum wages. 2026: (886×3 + 946×9) × 10 = 111 720 EUR, maximum social tax 36 867.60 EUR (EMTA).',
      },
    ],
  },

  incomeTaxSocialTaxDivisor: {
    label: 'Profit is divided by this before income tax, to deduct the FIE\'s own social tax',
    unit: 'multiplier',
    periods: [
      {
        from: '2018-01-01',
        value: 1.33,
        certainty: 'law',
        sources: [rt('TuMS', 'TuMS § 14 lg 5³–5⁵'), emta.fieGuide],
        note: 'If social tax is set by the minimum or the maximum base, the actual social tax is deducted instead of dividing (TuMS § 14 lg 5⁴–5⁵).',
      },
    ],
  },

  unemploymentInsuranceOnOwnIncome: {
    label: 'Unemployment insurance on the FIE\'s own business income',
    unit: 'rate',
    periods: [
      {
        from: '2026-01-01',
        value: 0,
        certainty: 'law',
        sources: [rt('TKindlS', 'TKindlS § 3 lg 2 p 1 (an FIE is not an insured person)'), emta.changes2026],
        note: '"FIE ei pea enda eest töötuskindlustusmakset tasuma."',
      },
    ],
  },

  fundedPensionOnOwnIncome: {
    label: 'Funded pension on the FIE\'s own income (same rate the person chose: 2, 4 or 6%)',
    unit: 'rate',
    periods: [
      {
        from: '2024-01-01',
        value: 0.02,
        certainty: 'official',
        sources: [emta.fieGuide, rt('KoPS', 'KoPS § 7, § 9')],
        note: 'Only if the FIE joined the II pillar. Paid once a year on the taxable income after social tax, capped by the same 10 × minimum wage base. Not deductible from business income.',
      },
    ],
  },
} satisfies Record<string, Rule<number>>;

// ---------------------------------------------------------------------------
// Payment days (used to place tax payments in the monthly cash flow)
// ---------------------------------------------------------------------------

export const paymentDays = {
  payrollTaxes: {
    label: 'Day of the next month by which payroll taxes are paid (social tax, withheld income tax)',
    unit: 'day of month',
    periods: [
      {
        from: '2026-01-01',
        value: 10,
        certainty: 'law',
        sources: [rt('SMS', 'SMS § 9 lg 1 p 4'), rt('TuMS', 'TuMS § 40 lg 4')],
      },
    ],
  },

  distributionTax: {
    label: 'Day of the next month by which corporate income tax on a dividend is declared',
    unit: 'day of month',
    periods: [
      {
        from: '2020-07-01',
        value: 10,
        certainty: 'law',
        sources: [rt('TuMS', 'TuMS § 54 lg 2')],
        note: 'The law text checked states the declaration day. We assume the tax is paid on the same day.',
      },
    ],
  },

  vat: {
    label: 'Day of the next month by which the VAT return is filed',
    unit: 'day of month',
    periods: [
      {
        from: '2026-01-01',
        value: 20,
        certainty: 'law',
        sources: [rt('KMS', 'KMS § 27 lg 1')],
        note: 'The law text checked states the return day. We assume VAT is paid on the same day, and that a VAT refund arrives in that month too; neither date was found in the texts checked.',
      },
    ],
  },
} satisfies Record<string, Rule<number>>;

/** When an FIE pays its own taxes (used to place them in the monthly cash flow). */
export const fieSchedule = {
  socialTaxAdvanceMonths: {
    label: 'Months in which the FIE pays the quarterly minimum social tax advance (by the 15th)',
    value: [3, 6, 9, 12],
    certainty: 'law',
    sources: [rt('SMS', 'SMS § 9 lg 3 p 1')],
  },
  settlementMonth: {
    label: 'Month of the next year in which the rest of the yearly tax is paid (by 1 October)',
    value: 10,
    certainty: 'law',
    sources: [rt('SMS', 'SMS § 9 lg 3 p 2 (social tax)'), emta.fieGuide],
    note: 'Law checked for social tax; EMTA states the same day for the funded pension. We assume income tax is paid the same day.',
  },
  incomeTaxAdvance: {
    label: 'Income tax advances in the second and later years: share of last year\'s tax per payment, months, and minimum',
    value: { sharePerPayment: 0.25, months: [9, 12], skipIfNotAbove: 300 },
    certainty: 'law',
    sources: [rt('TuMS', 'TuMS § 47 lg 1–3')],
    note: 'Not paid in the first year of business.',
  },
} satisfies Record<string, Sourced<unknown>>;

// ---------------------------------------------------------------------------
// Bank benchmarks — what lenders and EIS publish. Banks do not publish their
// internal credit rules, so these are reference points, not guarantees.
// ---------------------------------------------------------------------------

export const bankBenchmarks = {
  minDscr: {
    label: 'Debt service coverage ratio (DSCR) after the new loan, at least',
    value: 1.2,
    certainty: 'official',
    sources: [eis.loanGuarantee, eis.marketGuarantee, eis.starterLoan],
    note: 'EIS loan guarantee: recommended ("according to conservative estimates"). EIS starter loan: mandatory. EIS does not publish the formula; the app shows the formula it uses.',
  },

  minCurrentRatio: {
    label: 'Current ratio (current assets / short-term liabilities), at least',
    value: 1.1,
    certainty: 'official',
    sources: [eis.loanGuarantee, eis.starterLoan],
  },

  minEquityRatio: {
    label: 'Equity as a share of the balance sheet after the new loan, at least',
    value: 0.2,
    certainty: 'official',
    sources: [eis.loanGuarantee, eis.marketGuarantee],
    note: 'EIS starter loan (closed) used 15%.',
  },

  maxDebtToTurnover: {
    label: 'All financial liabilities as a share of forecast yearly turnover, at most',
    value: 0.7,
    certainty: 'official',
    sources: [eis.starterLoan],
    note: 'Recommended figure of the closed EIS starter loan. A soft warning only.',
  },

  ownContributionExamples: {
    label: 'Own contribution asked by lenders (examples)',
    value: [
      { lender: 'LHV investment loan', share: 0.3, of: 'loan amount', note: 'Can be replaced by extra collateral' },
      { lender: 'Coop Pank investment loan', share: 0.2, of: 'project cost', note: 'Bank finances up to 80% of project cost' },
      { lender: 'EIS starter loan (closed)', share: 0.1, of: 'project cost', note: 'Recommended minimum for investment loans' },
      { lender: 'LHV micro loan (5 000–50 000 EUR)', share: 0, of: 'loan amount', note: 'No own contribution, no collateral' },
    ],
    certainty: 'official',
    sources: [banks.lhvInvestment, banks.coopInvestment, eis.starterLoan, banks.lhvMicro],
  },

  eisGuarantee: {
    label: 'EIS loan guarantee (for firms without enough collateral or history)',
    value: {
      maxShareOfLoan: 0.8,
      maxShareOfLoanConstruction: 0.6,
      yearlyFeeRange: [0.008, 0.038],
      contractFeeShare: 0.005,
      contractFeeMinEur: 30,
    },
    certainty: 'official',
    sources: [eis.loanGuarantee, eis.marketGuarantee],
    note: 'The company applies through its bank, not directly to EIS. Yearly fee range is for investment and working-capital loans; contract fee 0.5% applies to guarantees up to 520 000 EUR.',
  },

  forecastFormat: {
    label: 'Financial forecast format expected in applications',
    value: {
      cashFlow: 'monthly for year 1, then yearly',
      incomeStatement: 'yearly',
      balanceSheet: 'yearly',
      yearsAhead: 3,
    },
    certainty: 'official',
    sources: [eis.forecastTemplate, eis.starterLoan],
    note: 'EIS forecast template: monthly cash flow for year 1, yearly figures for years 2–4, yearly income statement and balance sheet. EIS starter loan asked for "the next three years" of forecasts.',
  },
} satisfies Record<string, Sourced<unknown>>;

// ---------------------------------------------------------------------------
// Supported company types
// ---------------------------------------------------------------------------

export const companyTypes = ['OU', 'FIE'] as const;
export type CompanyType = (typeof companyTypes)[number];

export const estonia = {
  country: 'EE',
  currency: 'EUR',
  reviewed: CHECKED,
  companyTypes,
  payroll,
  corporate,
  vat,
  boardMember,
  wageIncomeTaxBase,
  soleProprietor,
  fieSchedule,
  paymentDays,
  bankBenchmarks,
} as const;
