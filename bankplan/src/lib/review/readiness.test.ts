import { describe, expect, it } from "vitest";
import { cafe } from "@/lib/finance/__tests__/cafe";
import type { PlanAnswers } from "@/lib/plan/answers";
import { checkPlan, interviewPoints, readinessScore, type CheckId, type PlanCheck } from "./readiness";

const twoSections: PlanAnswers = {
  idea: { q: {}, text: "Kohvik Tartu ülikooli lähedal." },
  market: { q: {}, text: "Konkurendid: kohvik A ja pagarikoda B." },
};
const byId = (checks: PlanCheck[]) => Object.fromEntries(checks.map((c) => [c.id, c])) as Record<CheckId, PlanCheck>;

describe("plan check (hand-calculated)", () => {
  it("the café plan from the calculator tests: 42 of 60 points", () => {
    const checks = byId(checkPlan(twoSections, cafe, "OU"));

    // Sections: 2 of 11 written → 2 × 2 = 4 points.
    expect(checks.sections).toMatchObject({ status: "partial", points: 4, max: 22, firstMissing: "summary" });
    // Sales and loan entered → 6 points.
    expect(checks.numbers).toMatchObject({ status: "ok", points: 6 });
    // DSCR: year 1 = 27 888 ÷ 11 770 = 2.369, year 2 = 27.61, year 3 no payments → lowest 2.369 ≥ 1.2 → 10.
    expect(checks.dscr).toMatchObject({ status: "ok", points: 10 });
    expect(checks.dscr.values.value).toBeCloseTo(2.3694, 4);
    // Cash: lowest is month 1. In: 5 000 + 12 000 + 12 400 = 29 400.
    // Out: goods 4 960 + rent 1 240 + equipment 14 880 + net pay 1 657.84 = 22 737.84 → 6 662.16 ≥ 0 → 8.
    expect(checks.cash).toMatchObject({ status: "ok", points: 8 });
    expect(checks.cash.values.lowest).toBeCloseTo(6662.16, 2);
    // Own money: 5 000 ÷ (5 000 + 12 000) = 29.4 % ≥ 20 % → 6.
    expect(checks.ownContribution).toMatchObject({ status: "ok", points: 6 });
    expect(checks.ownContribution.values.share).toBeCloseTo(0.2941, 4);
    // Equity share: lowest is year 1, 29 718 ÷ 32 936.16 = 0.902 ≥ 0.2 → 4.
    expect(checks.equity).toMatchObject({ status: "ok", points: 4 });
    expect(checks.equity.values.value).toBeCloseTo(0.9023, 4);
    // Current ratio: lowest is year 1, 7.25 ≥ 1.1 → 2.
    expect(checks.currentRatio).toMatchObject({ status: "ok", points: 2 });
    // Debt to sales: year 1 = 1 000 ÷ 120 000 = 0.008, then 0 → 0.008 ≤ 0.7 → 2.
    expect(checks.debtToTurnover).toMatchObject({ status: "ok", points: 2 });
    expect(checks.debtToTurnover.values.value).toBeCloseTo(0.00833, 5);

    // 4 + 6 + 10 + 8 + 6 + 4 + 2 + 2 = 42; the maximum is 60.
    const all = Object.values(checks);
    expect(all.reduce((sum, c) => sum + c.points, 0)).toBe(42);
    expect(all.reduce((sum, c) => sum + c.max, 0)).toBe(60);
  });

  it("a thin plan: DSCR below 1.2 and little own money give half points", () => {
    // Sales 8 000 €/month (96 000 a year), own money 1 500 €, everything else as in the café.
    // EBITDA year 1 = 96 000 × 60 % − 12 000 − 24 000 − 8 112 = 13 488.
    // DSCR year 1 = 13 488 ÷ (11 000 + 770) = 1.146 → between 1.0 and 1.2 → 5 of 10.
    // Own money: 1 500 ÷ 13 500 = 11.1 % → between 10 % and 20 % → 3 of 6.
    const thin = {
      ...cafe,
      ownContribution: 1500,
      revenue: [{ ...cafe.revenue[0], year1: Array(12).fill(8000), year2Total: 96000, year3Total: 96000 }],
    };
    const checks = byId(checkPlan(twoSections, thin, "OU"));
    expect(checks.dscr).toMatchObject({ status: "partial", points: 5 });
    expect(checks.dscr.values.value).toBeCloseTo(1.146, 3);
    expect(checks.ownContribution).toMatchObject({ status: "partial", points: 3 });
    expect(checks.ownContribution.values.share).toBeCloseTo(0.1111, 4);
  });

  it("cash below zero is found, with the month", () => {
    // Equipment 30 000 € + VAT bought in month 1.
    // Month 1: in 29 400; out 4 960 + 1 240 + 37 200 + 1 657.84 = 45 057.84 → −15 657.84.
    const bigBuy = { ...cafe, investments: [{ ...cafe.investments[0], amount: 30000 }] };
    const checks = byId(checkPlan(twoSections, bigBuy, "OU"));
    expect(checks.cash).toMatchObject({ status: "fail", points: 0 });
    expect(checks.cash.values.lowest).toBeCloseTo(-15657.84, 2);
    expect(checks.cash.values.month).toBe("2027-01");
  });

  it("an empty plan scores 0, and the money checks wait for the numbers", () => {
    const checks = checkPlan({}, null, "OU");
    expect(checks.reduce((sum, c) => sum + c.points, 0)).toBe(0);
    const ids = byId(checks);
    expect(ids.sections.status).toBe("fail");
    expect(ids.numbers.status).toBe("fail");
    expect(ids.dscr.status).toBe("needsNumbers");
    expect(ids.cash.status).toBe("needsNumbers");
  });

  it("sales without a loan: half the numbers points, no ratio checks yet", () => {
    const noLoan = { ...cafe, loan: { ...cafe.loan, amount: 0 } };
    const ids = byId(checkPlan(twoSections, noLoan, "OU"));
    expect(ids.numbers).toMatchObject({ status: "partial", points: 3 });
    expect(ids.dscr.status).toBe("needsNumbers");
  });
});

describe("interview points and total", () => {
  it("each of the 10 questions is worth 4 points: strong 4, ok 2, weak or unanswered 0", () => {
    expect(interviewPoints([])).toBe(0);
    expect(interviewPoints(Array(10).fill("strong"))).toBe(40);
    // 5 strong (20) + 3 ok (6) + 1 weak (0) + 1 unanswered (0) = 26.
    expect(interviewPoints(["strong", "strong", "strong", "strong", "strong", "ok", "ok", "ok", "weak", null])).toBe(26);
  });

  it("café plan 42 + interview 26 = 68 → almost ready", () => {
    const score = readinessScore(checkPlan(twoSections, cafe, "OU"), ["strong", "strong", "strong", "strong", "strong", "ok", "ok", "ok", "weak", null]);
    expect(score).toEqual({ plan: 42, interview: 26, total: 68, level: "almost" });
  });

  it("levels: below 50 not ready, 50–74 almost, 75 and more ready", () => {
    const checks = checkPlan(twoSections, cafe, "OU"); // 42
    expect(readinessScore(checks, []).level).toBe("notReady");
    expect(readinessScore(checks, Array(10).fill("strong")).level).toBe("ready"); // 82
  });
});
