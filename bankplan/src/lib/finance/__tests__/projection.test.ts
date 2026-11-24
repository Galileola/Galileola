import { describe, expect, it } from "vitest";
import { defaultFinanceInputs, type FinanceInputs } from "../inputs";
import { calculateProjection, type ProjectionResult } from "../projection";

function inputs(overrides: Partial<FinanceInputs>): FinanceInputs {
  return { ...defaultFinanceInputs(new Date("2026-12-15")), startMonth: "2027-01", ...overrides };
}

/** Assets must always equal liabilities + equity. */
function expectBalanced(result: ProjectionResult) {
  for (const y of result.years) {
    expect(y.balance.totalAssets).toBeCloseTo(y.balance.totalLiabilities + y.balance.equity, 2);
  }
}

/**
 * OÜ café, January 2027 start, VAT registered, customers pay at once.
 * - Sales 10 000 €/month (24% VAT), goods 40% of sales. Years 2 and 3: 120 000 € each.
 * - Rent 1 000 €/month + VAT.
 * - One employee, 2 000 € gross (employer cost 2 676 €/month, net pay 1 657.84 €).
 * - Equipment 12 000 € + VAT in month 1, written off over 5 years (200 €/month).
 * - Own money 5 000 €. Loan 12 000 € at 12% for 12 months, equal principal, paid out in month 1.
 */
const cafe = inputs({
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

describe("OÜ forecast (hand-calculated)", () => {
  const result = calculateProjection(cafe, "OU");
  const [y1, y2] = result.years;

  it("year 1 profit and loss", () => {
    // Revenue 120 000. Goods 48 000. Rent 12 000. Wages 24 000. Employer taxes (660 + 16) × 12 = 8 112.
    // EBITDA = 120 000 − 48 000 − 12 000 − 24 000 − 8 112 = 27 888.
    // Depreciation 200 × 12 = 2 400.
    // Interest: payments in months 2–12 on 12 000, 11 000 … 2 000 → 1% × 77 000 = 770.
    // Net profit = 27 888 − 2 400 − 770 = 24 718 (no dividend, so no income tax for an OÜ).
    expect(y1.revenue).toBeCloseTo(120000, 2);
    expect(y1.directCosts).toBeCloseTo(48000, 2);
    expect(y1.operatingCosts).toBeCloseTo(12000, 2);
    expect(y1.wages).toBeCloseTo(24000, 2);
    expect(y1.employerTaxes).toBeCloseTo(8112, 2);
    expect(y1.ebitda).toBeCloseTo(27888, 2);
    expect(y1.depreciation).toBeCloseTo(2400, 2);
    expect(y1.interest).toBeCloseTo(770, 2);
    expect(y1.incomeTaxes).toBe(0);
    expect(y1.netProfit).toBeCloseTo(24718, 2);
  });

  it("year 1 cash", () => {
    // In:  own 5 000 + loan 12 000 + sales with VAT 148 800 = 165 800.
    // Out: goods with VAT 59 520 + rent with VAT 14 880 + equipment with VAT 14 880
    //      + net pay 1 657.84 × 12 = 19 894.08
    //      + payroll taxes for months 1–11 paid in months 2–12: 11 × 1 018.16 = 11 199.76
    //      + VAT for months 1–11: month 1 is a refund of 1 680 (2 400 − 960 − 240 − 2 880), then 10 × 1 200 → 10 320
    //      + loan principal 11 000 + interest 770.
    // Out total 142 463.84 → cash at the end of year 1: 23 336.16.
    expect(y1.cashIn).toBeCloseTo(165800, 2);
    expect(y1.closingCash).toBeCloseTo(23336.16, 2);
    expect(result.months[1].cashVat).toBeCloseTo(-1680, 2); // refund for month 1, received in month 2
  });

  it("year 1 balance sheet", () => {
    // Fixed assets 12 000 − 2 400 = 9 600.
    // Taxes owed for December: VAT 1 200 + payroll taxes 1 018.16 = 2 218.16.
    // Loan left: 1 000 (due next month). Equity 5 000 + 24 718 = 29 718.
    expect(y1.balance.fixedAssets).toBeCloseTo(9600, 2);
    expect(y1.balance.taxPayable).toBeCloseTo(2218.16, 2);
    expect(y1.balance.loanCurrent).toBeCloseTo(1000, 2);
    expect(y1.balance.loanLongTerm).toBeCloseTo(0, 2);
    expect(y1.balance.equity).toBeCloseTo(29718, 2);
    expect(y1.balance.totalAssets).toBeCloseTo(32936.16, 2);
  });

  it("year 1 bank ratios", () => {
    // DSCR = 27 888 ÷ (11 000 + 770) = 2.369. Current ratio = 23 336.16 ÷ (2 218.16 + 1 000) = 7.251.
    // Equity ratio = 29 718 ÷ 32 936.16 = 0.902. Break-even = fixed costs 47 282 ÷ 60% margin = 78 803.33.
    expect(y1.ratios.dscr).toBeCloseTo(2.3694, 4);
    expect(y1.ratios.currentRatio).toBeCloseTo(7.2514, 4);
    expect(y1.ratios.equityRatio).toBeCloseTo(0.9023, 4);
    expect(y1.ratios.breakEvenRevenue).toBeCloseTo(78803.33, 2);
  });

  it("year 2", () => {
    // Last loan payment in month 13: principal 1 000 + interest 10. Net profit 27 888 − 2 400 − 10 = 25 478.
    // Cash: 148 800 in; out 74 400 + 19 894.08 + 12 × 1 018.16 + 12 × 1 200 + 1 010 = 121 922 → +26 878.
    // Cash at end of year 2: 23 336.16 + 26 878 = 50 214.16. DSCR = 27 888 ÷ 1 010 = 27.61.
    expect(y2.netProfit).toBeCloseTo(25478, 2);
    expect(y2.closingCash).toBeCloseTo(50214.16, 2);
    expect(y2.balance.equity).toBeCloseTo(55196, 2);
    expect(y2.ratios.dscr).toBeCloseTo(27.6119, 4);
    expect(result.years[2].ratios.dscr).toBeNull(); // no loan payments in year 3
  });

  it("balances every year and gives no warnings", () => {
    expectBalanced(result);
    expect(result.warnings).toEqual([]);
  });

  it("lists the 2027 social tax base as an assumption", () => {
    expect(result.assumptions).toContainEqual({ rule: "socialTaxMonthlyMinBase", year: 2027 });
  });

  it("dividend: 10 000 € at the end of year 2 costs 2 820.51 € tax, paid the month after", () => {
    const withDividend = calculateProjection({ ...cafe, dividends: [0, 10000, 0] }, "OU");
    expect(withDividend.years[1].incomeTaxes).toBeCloseTo(2820.51, 2);
    expect(withDividend.years[1].toOwner).toBe(10000);
    expect(withDividend.months[24].cashIncomeTaxes).toBeCloseTo(2820.51, 2);
    expectBalanced(withDividend);
  });
});

/**
 * FIE, January 2027 start, not VAT registered.
 * Sales 3 000 €/month every year, costs 500 €/month (no VAT), owner takes 1 000 €/month.
 * Profit 30 000 € a year. 2027 rules: monthly base 946 € (assumed), minimum wage 946 € (assumed).
 */
const fie = inputs({
  vatRegistered: false,
  revenue: [
    { id: "r1", name: "Design work", vatPercent: 24, directCostPercent: 0, year1: Array(12).fill(3000), year2Total: 36000, year3Total: 36000 },
  ],
  costs: [{ id: "c1", name: "Software and phone", monthly: 500, hasVat: false }],
  ownerDrawingsMonthly: 1000,
  fundedPensionPercent: 2,
  useBasicExemption: true,
});

describe("FIE forecast (hand-calculated)", () => {
  const result = calculateProjection(fie, "FIE");
  const [y1, y2] = result.years;

  it("owner's taxes for 2027", () => {
    // Social tax 30 000 ÷ 1.33 × 33% = 7 443.61 (minimum 3 746.16, maximum 37 461.60).
    // Taxable 22 556.39. Pension 451.13. Income tax (22 556.39 − 451.13 − 8 400) × 22% = 3 015.16.
    expect(result.fieTaxYears[0]).toMatchObject({
      calendarYear: 2027,
      months: 12,
      profit: 30000,
      socialTax: 7443.61,
      fundedPension: 451.13,
      incomeTax: 3015.16,
      total: 10909.9,
    });
    expect(y1.incomeTaxes).toBeCloseTo(10909.9, 2);
    expect(y1.netProfit).toBeCloseTo(19090.1, 2);
  });

  it("year 1 cash: only the quarterly minimum social tax is paid", () => {
    // Advances 946 × 33% × 3 = 936.54 per quarter → 3 746.16.
    // Cash = 36 000 − 6 000 − 12 000 drawings − 3 746.16 = 14 253.84.
    expect(result.months[2].cashIncomeTaxes).toBeCloseTo(936.54, 2);
    expect(y1.closingCash).toBeCloseTo(14253.84, 2);
    // Still owed: 10 909.90 − 3 746.16 = 7 163.74. Equity = 30 000 − 10 909.90 − 12 000 = 7 090.10.
    expect(y1.balance.taxPayable).toBeCloseTo(7163.74, 2);
    expect(y1.balance.equity).toBeCloseTo(7090.1, 2);
  });

  it("year 2 cash: advances and the 2027 settlement in October 2028", () => {
    // Income tax advances: 3 015.16 × 1/4 = 753.79 (> 300) in September and December 2028.
    // October 2028: (7 443.61 − 3 746.16) + 3 015.16 + 451.13 = 7 163.74.
    // Cash 2028 = 36 000 − 6 000 − 12 000 − 3 746.16 − 1 507.58 − 7 163.74 = 5 582.52 → 19 836.36.
    const october2028 = result.months.find((m) => m.month === "2028-10")!;
    const september2028 = result.months.find((m) => m.month === "2028-09")!;
    expect(october2028.cashIncomeTaxes).toBeCloseTo(7163.74, 2);
    expect(september2028.cashIncomeTaxes).toBeCloseTo(936.54 + 753.79, 2);
    expect(y2.closingCash).toBeCloseTo(19836.36, 2);
    expect(y2.balance.taxPayable).toBeCloseTo(5656.16, 2);
  });

  it("balances, no loan ratio, no VAT warning below 40 000 €", () => {
    expectBalanced(result);
    expect(y1.ratios.dscr).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it("a plan starting in July scales the first year to 6 months", () => {
    // Jul–Dec 2027: profit 6 × 2 500 = 15 000. Minimum base 6 × 946; tax-free 8 400 × 6/12 = 4 200.
    // Social tax 15 000 ÷ 1.33 × 33% = 3 721.80; pension 225.56; income tax (11 278.20 − 225.56 − 4 200) × 22% = 1 507.58.
    const july = calculateProjection({ ...fie, startMonth: "2027-07" }, "FIE");
    expect(july.fieTaxYears[0]).toMatchObject({ calendarYear: 2027, months: 6, socialTax: 3721.8, fundedPension: 225.56, incomeTax: 1507.58 });
    expectBalanced(july);
  });

  it("warns when sales pass the 40 000 € VAT registration limit", () => {
    const bigger = calculateProjection(
      { ...fie, revenue: [{ ...fie.revenue[0], year1: Array(12).fill(4000), year2Total: 48000, year3Total: 48000 }] },
      "FIE",
    );
    expect(bigger.warnings).toContainEqual({ code: "vatRegistrationNeeded", calendarYear: 2027, turnover: 48000, threshold: 40000 });
  });
});

describe("warnings", () => {
  it("flags running out of cash and a weak DSCR", () => {
    const weak = calculateProjection(
      {
        ...cafe,
        ownContribution: 0,
        revenue: [{ ...cafe.revenue[0], year1: Array(12).fill(4000), year2Total: 48000, year3Total: 48000 }],
      },
      "OU",
    );
    const codes = weak.warnings.map((w) => w.code);
    expect(codes).toContain("negativeCash");
    expect(codes).toContain("lowDscr");
    expectBalanced(weak);
  });
});
