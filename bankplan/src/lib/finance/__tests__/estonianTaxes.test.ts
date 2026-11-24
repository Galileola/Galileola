import { describe, expect, it } from "vitest";
import { estonia } from "@/config/countries/ee";
import { dividendTax } from "../ee/company";
import { monthlyPayslip, type PayrollRates } from "../ee/payroll";
import { fieYearTaxes } from "../ee/soleProprietor";
import { valueAt } from "../rules";

/** 2027 rates: 22% income tax, 700 € tax-free, 33% social tax on at least 946 €, 1.6% + 0.8% unemployment, 2% pension. */
const rates2027: PayrollRates = {
  incomeTax: 0.22,
  exemptionMonthly: 700,
  socialTax: 0.33,
  socialTaxMinBase: 946,
  unemploymentEmployee: 0.016,
  unemploymentEmployer: 0.008,
  fundedPension: 0.02,
};
const employee = { applyMinimumSocialTax: true, unemploymentInsurance: true };

describe("monthly pay (Estonia)", () => {
  it("employee earning 2 000 € gross", () => {
    // Social tax 2 000 × 33% = 660. Employer unemployment 2 000 × 0.8% = 16. Employer cost 2 676.
    // Employee: unemployment 32, pension 40, income tax (2 000 − 32 − 40 − 700) × 22% = 1 228 × 22% = 270.16.
    // Net = 2 000 − 32 − 40 − 270.16 = 1 657.84.
    expect(monthlyPayslip(2000, employee, rates2027)).toEqual({
      gross: 2000,
      socialTax: 660,
      unemploymentEmployer: 16,
      unemploymentEmployee: 32,
      fundedPension: 40,
      incomeTax: 270.16,
      net: 1657.84,
      withheld: 342.16,
      employerCost: 2676,
    });
  });

  it("employee earning 600 €: social tax is paid on the 946 € minimum", () => {
    // Social tax 946 × 33% = 312.18 (not 600 × 33% = 198). Income tax 0: 600 − 9.60 − 12 is below 700.
    const slip = monthlyPayslip(600, employee, rates2027);
    expect(slip.socialTax).toBe(312.18);
    expect(slip.incomeTax).toBe(0);
    expect(slip.net).toBe(578.4);
    expect(slip.employerCost).toBe(916.98);
  });

  it("OÜ board member fee of 1 500 €: no unemployment insurance, no minimum", () => {
    // Social tax 495. Pension 30. Income tax (1 500 − 30 − 700) × 22% = 169.40. Net 1 300.60.
    const slip = monthlyPayslip(1500, { applyMinimumSocialTax: false, unemploymentInsurance: false }, rates2027);
    expect(slip).toMatchObject({ socialTax: 495, unemploymentEmployer: 0, unemploymentEmployee: 0, incomeTax: 169.4, net: 1300.6, employerCost: 1995 });
  });

  it("board member rules in the config say: no unemployment insurance, no minimum", () => {
    expect(estonia.boardMember.unemploymentInsurance.value).toBe(false);
    expect(estonia.boardMember.socialTaxMinimum.value).toBe(false);
  });
});

describe("OÜ dividend tax", () => {
  it("is 22/78 of the net dividend", () => {
    // 7 800 ÷ 0.78 × 22% = 2 200. 10 000 ÷ 0.78 × 22% = 2 820.51.
    expect(dividendTax(7800, 0.22, 0.78)).toBe(2200);
    expect(dividendTax(10000, 0.22, 0.78)).toBe(2820.51);
    expect(dividendTax(0, 0.22, 0.78)).toBe(0);
  });
});

describe("FIE own taxes for a full year (2026 rules)", () => {
  // 2026: monthly base 886 € → minimum base 12 × 886 = 10 632.
  // Minimum wage 886 € (Jan–Mar) and 946 € (Apr–Dec) → 2 658 + 8 514 = 11 172; maximum base 10 × 11 172 = 111 720.
  const year2026 = {
    socialTaxMinBaseSum: 886 * 12,
    minimumWageSum: 886 * 3 + 946 * 9,
    exemption: 8400,
    fundedPensionRate: 0.02,
    rates: { socialTax: 0.33, incomeTax: 0.22, socialTaxDivisor: 1.33, maxBaseMinimumWages: 10 },
  };

  it("profit 30 000 €: normal case", () => {
    // Social tax 30 000 ÷ 1.33 × 33% = 7 443.61. Taxable 30 000 − 7 443.61 = 22 556.39 (= 30 000 ÷ 1.33).
    // Pension 2% = 451.13. Income tax (22 556.39 − 451.13 − 8 400) × 22% = 13 705.26 × 22% = 3 015.16.
    expect(fieYearTaxes({ ...year2026, profit: 30000 })).toEqual({
      socialTax: 7443.61,
      taxableIncome: 22556.39,
      fundedPension: 451.13,
      incomeTax: 3015.16,
      total: 10909.9,
    });
  });

  it("profit 5 000 €: the minimum social tax applies", () => {
    // 5 000 ÷ 1.33 × 33% = 1 240.60 is below the minimum 10 632 × 33% = 3 508.56, so 3 508.56 is paid.
    // Taxable 5 000 − 3 508.56 = 1 491.44; pension 29.83; income tax 0 (below the tax-free 8 400).
    expect(fieYearTaxes({ ...year2026, profit: 5000 })).toEqual({
      socialTax: 3508.56,
      taxableIncome: 1491.44,
      fundedPension: 29.83,
      incomeTax: 0,
      total: 3538.39,
    });
  });

  it("profit 200 000 €: the maximum social tax applies (EMTA: 36 867.60 € in 2026)", () => {
    // Pension capped at 111 720 × 2% = 2 234.40 (EMTA's figure).
    // Income tax (163 132.40 − 2 234.40 − 8 400) × 22% = 33 549.56.
    expect(fieYearTaxes({ ...year2026, profit: 200000 })).toEqual({
      socialTax: 36867.6,
      taxableIncome: 163132.4,
      fundedPension: 2234.4,
      incomeTax: 33549.56,
      total: 72651.56,
    });
  });

  it("a loss still owes the minimum social tax", () => {
    expect(fieYearTaxes({ ...year2026, profit: -2000 })).toMatchObject({ socialTax: 3508.56, incomeTax: 0, fundedPension: 0 });
  });
});

describe("rule lookup by date", () => {
  it("minimum wage changed on 1 April 2026", () => {
    expect(valueAt(estonia.payroll.minimumWageMonthly, "2026-03-01")).toEqual({ value: 886, assumed: false });
    expect(valueAt(estonia.payroll.minimumWageMonthly, "2026-04-01")).toEqual({ value: 946, assumed: false });
  });

  it("2027 social tax base is marked as an assumption", () => {
    expect(valueAt(estonia.payroll.socialTaxMonthlyMinBase, "2026-12-01")).toEqual({ value: 886, assumed: false });
    expect(valueAt(estonia.payroll.socialTaxMonthlyMinBase, "2027-01-01")).toEqual({ value: 946, assumed: true });
  });

  it("values in force by law stay confirmed (VAT 24%)", () => {
    expect(valueAt(estonia.vat.standardRate, "2028-06-01")).toEqual({ value: 0.24, assumed: false });
  });

  it("refuses dates before a rule starts", () => {
    expect(() => valueAt(estonia.vat.standardRate, "2025-06-01")).toThrow();
  });

  it("matches EMTA's published 2026 FIE figures", () => {
    const base = valueAt(estonia.payroll.socialTaxMonthlyMinBase, "2026-06-01").value;
    const rate = valueAt(estonia.payroll.socialTaxRate, "2026-06-01").value;
    expect(Math.round(base * 3 * rate * 100) / 100).toBe(877.14); // quarterly advance
  });
});
