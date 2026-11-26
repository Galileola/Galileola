import { describe, expect, it } from "vitest";
import { explainCalculations, STEP_KEYS, type ExplainTopic, type TopicId } from "../explain";
import { calculateProjection } from "../projection";
import type { FinanceInputs } from "../inputs";
import { cafe, inputs } from "./cafe";

function topics(i: FinanceInputs, type: "OU" | "FIE" = "OU") {
  return explainCalculations(i, type, calculateProjection(i, type));
}
function topic(list: ExplainTopic[], id: TopicId, index = 0) {
  return list.filter((t) => t.id === id)[index];
}
/** The numbers of one step, as plain values. */
function step(t: ExplainTopic, key: string): Record<string, number> {
  const found = t.steps.find((s) => s.key === key);
  if (!found) throw new Error(`step ${key} missing`);
  return Object.fromEntries(Object.entries(found.values).map(([name, v]) => [name, v.value]));
}
const keys = (t: ExplainTopic) => t.steps.map((s) => s.key);

describe("wages explained (hand-calculated)", () => {
  it("café barista, 2 000 € gross", () => {
    // Employer: social tax 33% × 2 000 = 660, unemployment 0.8% × 2 000 = 16 → cost 2 676.
    // Person: unemployment 1.6% = 32, pension 2% = 40, taxable 2 000 − 32 − 40 − 700 = 1 228,
    // income tax 22% = 270.16, net 2 000 − 32 − 40 − 270.16 = 1 657.84.
    const pay = topic(topics(cafe), "payroll");
    expect(pay.subject).toBe("Barista");
    expect(keys(pay)).not.toContain("payMinimumBase");
    expect(step(pay, "paySocialTax")).toEqual({ rate: 0.33, base: 2000, amount: 660 });
    expect(step(pay, "payUnemploymentEmployer").amount).toBe(16);
    expect(step(pay, "payEmployerCost")).toEqual({ gross: 2000, socialTax: 660, unemployment: 16, cost: 2676 });
    expect(step(pay, "payUnemploymentEmployee").amount).toBe(32);
    expect(step(pay, "payPension").amount).toBe(40);
    expect(step(pay, "payTaxable").taxable).toBe(1228);
    expect(step(pay, "payIncomeTax").amount).toBe(270.16);
    expect(step(pay, "payNet").net).toBe(1657.84);
  });

  it("part-time 600 € with the minimum social tax uses the 2027 monthly base 946 €", () => {
    // Social tax 33% × 946 = 312.18. Unemployment 4.80 (employer), 9.60 (person), pension 12.
    // Taxable 600 − 9.60 − 12 − 700 < 0 → 0, so no income tax. Net 600 − 9.60 − 12 = 578.40. Cost 916.98.
    const i = inputs({
      staff: [{ id: "s", role: "Cleaner", kind: "employee", grossMonthly: 600, count: 2, startMonth: 1, minimumSocialTax: true }],
    });
    const pay = topic(topics(i), "payroll");
    expect(step(pay, "payMinimumBase").minBase).toBe(946);
    expect(step(pay, "paySocialTax")).toEqual({ rate: 0.33, base: 946, amount: 312.18 });
    expect(step(pay, "payEmployerCost").cost).toBe(916.98);
    expect(step(pay, "payCount")).toEqual({ count: 2, total: 1833.96 });
    expect(step(pay, "payTaxable").taxable).toBe(0);
    expect(step(pay, "payIncomeTax").amount).toBe(0);
    expect(step(pay, "payNet").net).toBe(578.4);
  });

  it("OÜ board member fee 1 000 €: no unemployment insurance, no minimum", () => {
    // Social tax 330, cost 1 330. Pension 20, taxable 1 000 − 20 − 700 = 280, income tax 61.60, net 918.40.
    const i = inputs({
      staff: [{ id: "s", role: "Board", kind: "boardMember", grossMonthly: 1000, count: 1, startMonth: 1, minimumSocialTax: true }],
    });
    const pay = topic(topics(i), "payroll");
    expect(keys(pay)).toContain("payNoUnemployment");
    expect(keys(pay)).not.toContain("payUnemploymentEmployee");
    expect(step(pay, "payEmployerCost").cost).toBe(1330);
    expect(step(pay, "payIncomeTax").amount).toBe(61.6);
    expect(step(pay, "payNet").net).toBe(918.4);
  });
});

describe("loan explained (hand-calculated)", () => {
  it("café loan: 12 000 € equal principal over 12 months at 12%", () => {
    // Principal 12 000 ÷ 12 = 1 000. First interest 1% × 12 000 = 120 → first payment 1 120.
    // Interest over the loan: 1% × (12 000 + 11 000 + … + 1 000) = 1% × 78 000 = 780. No contract fee.
    const loan = topic(topics(cafe), "loan");
    expect(step(loan, "loanRate")).toEqual({ annual: 0.12, monthly: 0.01 });
    expect(step(loan, "loanEqualPrincipal").principal).toBe(1000);
    expect(step(loan, "loanFirst")).toMatchObject({ payment: 1120, interest: 120, principal: 1000 });
    expect(step(loan, "loanTotalInterest").total).toBe(780);
    expect(keys(loan)).not.toContain("loanFee");
  });

  it("annuity: 25 000 € over 60 months at 8%, 1% fee", () => {
    // r = 0.08 ÷ 12. Payment = 25 000 × r ÷ (1 − (1 + r)^−60) = 506.91.
    // First month interest 25 000 × r = 166.67, principal 506.91 − 166.67 = 340.24. Fee 250.
    // Interest over the loan ≈ 60 × 506.91 − 25 000 = 5 414.60 (the last payment is rounded).
    const i = inputs({
      loan: { amount: 25000, annualInterestPercent: 8, termMonths: 60, type: "annuity", graceMonths: 0, disbursementMonth: 1, contractFeePercent: 1 },
    });
    const loan = topic(topics(i), "loan");
    expect(step(loan, "loanAnnuity")).toEqual({ amount: 25000, months: 60, payment: 506.91 });
    expect(step(loan, "loanFirst")).toMatchObject({ interest: 166.67, principal: 340.24 });
    expect(step(loan, "loanTotalInterest").total).toBeCloseTo(5414.6, 0);
    expect(step(loan, "loanFee")).toEqual({ rate: 0.01, amount: 25000, fee: 250 });
  });

  it("annuity with 2 interest-only months: 10 000 € at 6% for 12 months", () => {
    // Interest-only months: 0.5% × 10 000 = 50. Then 10 payments of 10 000 × 0.005 ÷ (1 − 1.005^−10) = 50 ÷ 0.048652 = 1 027.71.
    const i = inputs({
      loan: { amount: 10000, annualInterestPercent: 6, termMonths: 12, type: "annuity", graceMonths: 2, disbursementMonth: 1, contractFeePercent: 0 },
    });
    const loan = topic(topics(i), "loan");
    expect(step(loan, "loanGrace")).toEqual({ months: 2, interest: 50 });
    expect(step(loan, "loanAnnuity")).toEqual({ amount: 10000, months: 10, payment: 1027.71 });
    expect(step(loan, "loanFirst")).toMatchObject({ interest: 50, principal: 977.71 });
  });

  it("no loan, no loan explanation", () => {
    expect(topic(topics(inputs({})), "loan")).toBeUndefined();
  });
});

describe("VAT explained (hand-calculated)", () => {
  it("café, VAT registered, year 1", () => {
    // VAT on sales 24% × 120 000 = 28 800.
    // VAT on purchases: goods 48 000 + rent 12 000 + coffee machine 12 000 = 72 000 × 24% = 17 280.
    // To pay 28 800 − 17 280 = 11 520, by the 20th of the next month.
    const vat = topic(topics(cafe), "vat");
    expect(step(vat, "vatSales").amount).toBe(28800);
    expect(step(vat, "vatPurchases").amount).toBe(17280);
    expect(step(vat, "vatToPay").net).toBe(11520);
    expect(step(vat, "vatWhen").day).toBe(20);
  });

  it("refund when purchases carry more VAT than sales", () => {
    // Sales 1 000 a month (12 000 a year, VAT 2 880); a 20 000 € machine (VAT 4 800) → refund 1 920.
    const i = inputs({
      revenue: [{ id: "r", name: "Sales", vatPercent: 24, directCostPercent: 0, year1: Array(12).fill(1000), year2Total: 0, year3Total: 0 }],
      investments: [{ id: "i", name: "Machine", amount: 20000, month: 1, hasVat: true, lifeYears: 5 }],
    });
    expect(step(topic(topics(i), "vat"), "vatRefund").net).toBe(1920);
  });

  it("not registered: VAT is a cost, registration above 40 000 €", () => {
    const vat = topic(topics(inputs({ vatRegistered: false })), "vat");
    expect(keys(vat)).toEqual(["vatNotRegistered", "vatThreshold"]);
    expect(step(vat, "vatThreshold").threshold).toBe(40000);
  });
});

describe("OÜ dividend tax explained (hand-calculated)", () => {
  it("dividend 7 800 € in year 2: 7 800 ÷ 0.78 × 22% = 2 200 €", () => {
    const div = topic(topics({ ...cafe, dividends: [0, 7800, 0] }), "dividendTax");
    expect(step(div, "divTax")).toEqual({ year: 2, dividend: 7800, divisor: 0.78, rate: 0.22, tax: 2200 });
    expect(keys(div)).toContain("divRetained");
  });

  it("no dividends: no income tax", () => {
    expect(keys(topic(topics(cafe), "dividendTax"))).toEqual(["divNone"]);
  });
});

describe("FIE taxes explained (hand-calculated)", () => {
  const fie = (monthlySales: number) =>
    inputs({
      vatRegistered: false,
      revenue: [
        { id: "r", name: "Design", vatPercent: 24, directCostPercent: 0, year1: Array(12).fill(monthlySales), year2Total: 0, year3Total: 0 },
      ],
      fundedPensionPercent: 2,
      useBasicExemption: true,
    });

  it("profit 30 000 € in 2027", () => {
    // Social tax 30 000 ÷ 1.33 × 33% = 7 443.61 (minimum 12 × 946 × 33% = 3 746.16 is lower).
    // Taxable 30 000 − 7 443.61 = 22 556.39. Pension 2% = 451.13. Tax-free income 8 400.
    // Income tax (22 556.39 − 451.13 − 8 400) × 22% = 3 015.16. Total 7 443.61 + 451.13 + 3 015.16 = 10 909.90.
    const t = topic(topics(fie(2500), "FIE"), "fieTaxes");
    expect(step(t, "fieProfit")).toEqual({ year: 2027, months: 12, profit: 30000 });
    expect(step(t, "fieSocialTax").amount).toBe(7443.61);
    expect(keys(t)).not.toContain("fieSocialTaxMinimum");
    expect(step(t, "fieTaxable").taxable).toBe(22556.39);
    expect(step(t, "fiePension").amount).toBe(451.13);
    expect(step(t, "fieExemption").amount).toBe(8400);
    expect(step(t, "fieIncomeTax").amount).toBe(3015.16);
    expect(step(t, "fieTotal").total).toBe(10909.9);
  });

  it("profit 6 000 €: the yearly minimum social tax applies", () => {
    // Normal 6 000 ÷ 1.33 × 33% = 1 488.72, below the minimum 3 746.16 → 3 746.16 is paid.
    const t = topic(topics(fie(500), "FIE"), "fieTaxes");
    expect(step(t, "fieSocialTax").amount).toBe(1488.72);
    expect(step(t, "fieSocialTaxMinimum")).toEqual({ months: 12, minimum: 3746.16 });
    expect(step(t, "fieTaxable").socialTax).toBe(3746.16);
  });
});

describe("depreciation explained (hand-calculated)", () => {
  it("coffee machine 12 000 € over 5 years: 2 400 € a year, 200 € a month", () => {
    const dep = topic(topics(cafe), "depreciation");
    expect(dep.subject).toBe("Coffee machine");
    expect(step(dep, "depPerYear")).toEqual({ cost: 12000, years: 5, perYear: 2400, perMonth: 200 });
  });

  it("not VAT registered: the VAT is part of the cost (12 000 × 1.24 = 14 880 → 2 976 a year)", () => {
    const dep = topic(topics({ ...cafe, vatRegistered: false }), "depreciation");
    expect(step(dep, "depCostWithVat")).toEqual({ amount: 12000, rate: 0.24, cost: 14880 });
    expect(step(dep, "depPerYear")).toMatchObject({ perYear: 2976, perMonth: 248 });
  });
});

describe("bank ratios explained (café year 1, same numbers as the forecast tests)", () => {
  const list = topics(cafe);

  it("DSCR = 27 888 ÷ (11 000 + 770) = 2.37, minimum 1.2", () => {
    const d = topic(list, "dscr");
    expect(step(d, "dscrAvailable").available).toBe(27888);
    expect(step(d, "dscrDebtService")).toEqual({ principal: 11000, interest: 770, service: 11770 });
    expect(step(d, "dscrResult").dscr).toBeCloseTo(2.3694, 4);
    expect(step(d, "dscrResult").minimum).toBe(1.2);
    expect(d.sources.length).toBeGreaterThan(0);
  });

  it("break-even = 47 282 ÷ 60% = 78 803.33", () => {
    // Fixed: rent 12 000 + wages 24 000 + employer taxes 8 112 + depreciation 2 400 + interest 770 = 47 282.
    const b = topic(list, "breakEven");
    expect(step(b, "beFixed").fixed).toBe(47282);
    expect(step(b, "beMargin").margin).toBeCloseTo(0.6, 10);
    expect(step(b, "beResult").breakEven).toBe(78803.33);
  });

  it("equity ratio = (5 000 + 24 718) ÷ 32 936.16 = 90%", () => {
    const e = topic(list, "equityRatio");
    expect(step(e, "eqEquity")).toMatchObject({ own: 5000, profit: 24718, paid: 0, equity: 29718 });
    expect(step(e, "eqResult").ratio).toBeCloseTo(0.9023, 4);
  });

  it("current ratio = 23 336.16 ÷ (2 218.16 + 1 000) = 7.25", () => {
    const c = topic(list, "currentRatio");
    expect(step(c, "crAssets").total).toBe(23336.16);
    expect(step(c, "crLiabilities")).toEqual({ taxPayable: 2218.16, loanCurrent: 1000, total: 3218.16 });
    expect(step(c, "crResult").ratio).toBeCloseTo(7.2514, 4);
  });

  it("FIE DSCR also takes off the owner's drawings", () => {
    const fie = inputs({
      vatRegistered: false,
      revenue: [{ id: "r", name: "Work", vatPercent: 24, directCostPercent: 0, year1: Array(12).fill(3000), year2Total: 36000, year3Total: 36000 }],
      ownerDrawingsMonthly: 1000,
      loan: { amount: 6000, annualInterestPercent: 12, termMonths: 12, type: "equalPrincipal", graceMonths: 0, disbursementMonth: 1, contractFeePercent: 0 },
    });
    const result = calculateProjection(fie, "FIE");
    const d = topic(explainCalculations(fie, "FIE", result), "dscr");
    const y1 = result.years[0];
    expect(step(d, "dscrDrawings").drawings).toBe(12000);
    expect(step(d, "dscrAvailable").available).toBeCloseTo(y1.ebitda - y1.incomeTaxes - 12000, 2);
    expect(step(d, "dscrResult").dscr).toBeCloseTo(y1.ratios.dscr!, 10);
  });
});

it("uses only known step keys", () => {
  const all = [...topics(cafe), ...topics({ ...cafe, dividends: [1000, 0, 0], vatRegistered: false })];
  for (const t of all) for (const s of t.steps) expect(STEP_KEYS).toContain(s.key);
});
