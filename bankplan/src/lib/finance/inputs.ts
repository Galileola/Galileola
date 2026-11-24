import { z } from "zod";

/**
 * Everything the user enters on the "Numbers" screen. Stored as JSON in plans.finance.
 * Amounts are in euros WITHOUT VAT. Percentages are entered as 0–100.
 */

const money = z.number().min(0).max(100_000_000);
const planMonth = z.number().int().min(1).max(36);

export const VAT_PERCENTS = [24, 13, 9, 0] as const;
export const PENSION_PERCENTS = [0, 2, 4, 6] as const;

const revenueLine = z.object({
  id: z.string().max(40),
  name: z.string().max(100),
  vatPercent: z.union(VAT_PERCENTS.map((value) => z.literal(value))),
  /** Goods and materials as a share of these sales (variable cost). */
  directCostPercent: z.number().min(0).max(100),
  /** Sales in each month of year 1. */
  year1: z.array(money).length(12),
  /** Sales in years 2 and 3; spread over the months like year 1. */
  year2Total: money,
  year3Total: money,
});

const costLine = z.object({
  id: z.string().max(40),
  name: z.string().max(100),
  monthly: money,
  hasVat: z.boolean(),
});

const staffLine = z.object({
  id: z.string().max(40),
  role: z.string().max(100),
  kind: z.enum(["employee", "boardMember"]),
  grossMonthly: money,
  count: z.number().int().min(1).max(500),
  /** Month of the forecast (1–36) in which the person starts. */
  startMonth: planMonth,
  /** Employer pays social tax on at least the monthly base (normal for a full-time employee). */
  minimumSocialTax: z.boolean(),
});

const investmentLine = z.object({
  id: z.string().max(40),
  name: z.string().max(100),
  amount: money,
  month: planMonth,
  hasVat: z.boolean(),
  /** Straight-line depreciation over this many years. */
  lifeYears: z.number().int().min(1).max(50),
});

const loan = z
  .object({
    amount: money,
    annualInterestPercent: z.number().min(0).max(50),
    termMonths: z.number().int().min(1).max(360),
    type: z.enum(["annuity", "equalPrincipal"]),
    graceMonths: z.number().int().min(0).max(36),
    disbursementMonth: planMonth,
    contractFeePercent: z.number().min(0).max(10),
  })
  .refine((value) => value.graceMonths < value.termMonths, { path: ["graceMonths"] });

export const financeInputsSchema = z.object({
  version: z.literal(1),
  /** First month of the forecast, "YYYY-MM". */
  startMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  vatRegistered: z.boolean(),
  /** How many months after the sale customers pay (0 = same month). */
  salesPaymentDelayMonths: z.number().int().min(0).max(3),
  revenue: z.array(revenueLine).max(20),
  costs: z.array(costLine).max(30),
  /** Yearly change of running costs in years 2 and 3. */
  costGrowthPercent: z.number().min(-50).max(100),
  staff: z.array(staffLine).max(30),
  /** Yearly pay rise in years 2 and 3. */
  wageGrowthPercent: z.number().min(-50).max(100),
  investments: z.array(investmentLine).max(30),
  /** Owner's own money put in at the start (in the first month). */
  ownContribution: money,
  /** Amount 0 means no loan. */
  loan,
  /** OÜ only: net dividend paid at the end of plan years 1, 2 and 3. */
  dividends: z.array(money).length(3),
  /** FIE only: money the owner takes out each month for living costs. */
  ownerDrawingsMonthly: money,
  /** FIE only: owner's funded pension rate (0 if not in the II pillar). */
  fundedPensionPercent: z.union(PENSION_PERCENTS.map((value) => z.literal(value))),
  /** FIE only: the owner's tax-free income is not used by an employer. */
  useBasicExemption: z.boolean(),
});

export type FinanceInputs = z.infer<typeof financeInputsSchema>;
export type RevenueLine = FinanceInputs["revenue"][number];
export type CostLine = FinanceInputs["costs"][number];
export type StaffLine = FinanceInputs["staff"][number];
export type InvestmentLine = FinanceInputs["investments"][number];

/** A blank starting point. The forecast starts next month. */
export function defaultFinanceInputs(today = new Date()): FinanceInputs {
  const next = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
  const startMonth = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
  return {
    version: 1,
    startMonth,
    vatRegistered: true,
    salesPaymentDelayMonths: 0,
    revenue: [],
    costs: [],
    costGrowthPercent: 0,
    staff: [],
    wageGrowthPercent: 0,
    investments: [],
    ownContribution: 0,
    loan: {
      amount: 0,
      annualInterestPercent: 8,
      termMonths: 60,
      type: "annuity",
      graceMonths: 0,
      disbursementMonth: 1,
      contractFeePercent: 1,
    },
    dividends: [0, 0, 0],
    ownerDrawingsMonthly: 0,
    fundedPensionPercent: 2,
    useBasicExemption: true,
  };
}
