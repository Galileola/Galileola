import { describe, expect, it } from "vitest";
import { sum } from "../money";
import { loanSchedule } from "../loan";

describe("loan schedule", () => {
  it("annuity: 10 000 € at 12% a year for 12 months", () => {
    // Monthly rate 1%. Payment = 10 000 × 0.01 / (1 − 1.01^−12) = 888.4879 → 888.49 €.
    // Month 1: interest 10 000 × 1% = 100.00, principal 888.49 − 100 = 788.49, left 9 211.51.
    // Month 2: interest 9 211.51 × 1% = 92.12, principal 796.37, left 8 415.14.
    // Month 12 clears the rest: principal 879.67 + interest 8.80 = 888.47.
    const s = loanSchedule({ amount: 10000, annualRate: 0.12, termMonths: 12, type: "annuity", graceMonths: 0 });
    expect(s).toHaveLength(12);
    expect(s[0]).toEqual({ number: 1, interest: 100, principal: 788.49, payment: 888.49, balanceAfter: 9211.51 });
    expect(s[1]).toEqual({ number: 2, interest: 92.12, principal: 796.37, payment: 888.49, balanceAfter: 8415.14 });
    expect(s[11]).toEqual({ number: 12, interest: 8.8, principal: 879.67, payment: 888.47, balanceAfter: 0 });
    expect(sum(s.map((p) => p.principal))).toBeCloseTo(10000, 2);
    expect(sum(s.map((p) => p.interest))).toBeCloseTo(661.86, 2);
  });

  it("equal principal: 12 000 € at 12% a year for 12 months", () => {
    // Principal 1 000 € every month. Interest 1% of what is left: 120, 110, 100 … 10.
    // Total interest = 1% × (12 000 + 11 000 + … + 1 000) = 1% × 78 000 = 780 €.
    const s = loanSchedule({ amount: 12000, annualRate: 0.12, termMonths: 12, type: "equalPrincipal", graceMonths: 0 });
    expect(s[0]).toEqual({ number: 1, interest: 120, principal: 1000, payment: 1120, balanceAfter: 11000 });
    expect(s[11]).toEqual({ number: 12, interest: 10, principal: 1000, payment: 1010, balanceAfter: 0 });
    expect(sum(s.map((p) => p.interest))).toBeCloseTo(780, 2);
  });

  it("interest-only months first, then equal principal", () => {
    // 12 000 € at 12%, 15 months, first 3 months interest only (120 € each).
    // Then 12 × 1 000 € principal: interest 120 … 10 = 780. Total interest 360 + 780 = 1 140 €.
    const s = loanSchedule({ amount: 12000, annualRate: 0.12, termMonths: 15, type: "equalPrincipal", graceMonths: 3 });
    expect(s.slice(0, 3).map((p) => p.payment)).toEqual([120, 120, 120]);
    expect(s[3]).toEqual({ number: 4, interest: 120, principal: 1000, payment: 1120, balanceAfter: 11000 });
    expect(sum(s.map((p) => p.interest))).toBeCloseTo(1140, 2);
    expect(s[14].balanceAfter).toBe(0);
  });

  it("interest-only months first, then annuity", () => {
    // After 3 months of 100 € interest, the same 888.49 € annuity as above over 12 months.
    const s = loanSchedule({ amount: 10000, annualRate: 0.12, termMonths: 15, type: "annuity", graceMonths: 3 });
    expect(s.slice(0, 3).map((p) => p.payment)).toEqual([100, 100, 100]);
    expect(s[3].payment).toBe(888.49);
    expect(s[14].balanceAfter).toBe(0);
  });

  it("no interest: the amount is split evenly", () => {
    const s = loanSchedule({ amount: 1200, annualRate: 0, termMonths: 12, type: "annuity", graceMonths: 0 });
    expect(s.every((p) => p.payment === 100 && p.interest === 0)).toBe(true);
  });

  it("no loan gives an empty schedule, and a too-long grace period is refused", () => {
    expect(loanSchedule({ amount: 0, annualRate: 0.1, termMonths: 12, type: "annuity", graceMonths: 0 })).toEqual([]);
    expect(() =>
      loanSchedule({ amount: 1000, annualRate: 0.1, termMonths: 12, type: "annuity", graceMonths: 12 }),
    ).toThrow();
  });
});
