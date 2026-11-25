import { defaultFinanceInputs, type FinanceInputs } from "../inputs";

/** Test helper: default inputs starting January 2027, with some fields replaced. */
export function inputs(overrides: Partial<FinanceInputs>): FinanceInputs {
  return { ...defaultFinanceInputs(new Date("2026-12-15")), startMonth: "2027-01", ...overrides };
}

/**
 * OÜ café, January 2027 start, VAT registered, customers pay at once.
 * - Sales 10 000 €/month (24% VAT), goods 40% of sales. Years 2 and 3: 120 000 € each.
 * - Rent 1 000 €/month + VAT.
 * - One employee, 2 000 € gross (employer cost 2 676 €/month, net pay 1 657.84 €).
 * - Equipment 12 000 € + VAT in month 1, written off over 5 years (200 €/month).
 * - Own money 5 000 €. Loan 12 000 € at 12% for 12 months, equal principal, paid out in month 1.
 */
export const cafe = inputs({
  vatRegistered: true,
  revenue: [
    { id: "r1", name: "Café sales", vatPercent: 24, directCostPercent: 40, year1: Array(12).fill(10000), year2Total: 120000, year3Total: 120000 },
  ],
  costs: [{ id: "c1", name: "Rent", monthly: 1000, hasVat: true }],
  staff: [
    { id: "s1", role: "Barista", kind: "employee", grossMonthly: 2000, count: 1, startMonth: 1, minimumSocialTax: true },
  ],
  investments: [{ id: "i1", name: "Coffee machine", amount: 12000, month: 1, hasVat: true, lifeYears: 5 }],
  ownContribution: 5000,
  loan: { amount: 12000, annualInterestPercent: 12, termMonths: 12, type: "equalPrincipal", graceMonths: 0, disbursementMonth: 1, contractFeePercent: 0 },
});
