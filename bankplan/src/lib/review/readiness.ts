/**
 * Readiness score: how ready is the plan to show to a bank?
 *
 *   Plan check (60 points)       – worked out by the app from the plan itself:
 *                                  written sections and the bank ratios from the calculator.
 *   Bank officer interview (40)  – the AI officer's 10 hardest questions; each answer is rated.
 *
 * The bank thresholds come from the config file (src/config/countries/ee.ts), with sources.
 * The points per check are this app's own weighting, not a bank rule.
 */
import { estonia, type CompanyType } from "@/config/countries/ee";
import { filledFinanceInputs } from "@/lib/finance/inputs";
import { calculateProjection } from "@/lib/finance/projection";
import type { PlanAnswers } from "@/lib/plan/answers";
import { bankLoanSections, type BankLoanSection } from "@/plan-types/bank-loan/sections";

const benchmarks = estonia.bankBenchmarks;

export const PLAN_CHECK_MAX = 60;
export const INTERVIEW_MAX = 40;

export type CheckId =
  | "sections"
  | "numbers"
  | "dscr"
  | "cash"
  | "ownContribution"
  | "equity"
  | "currentRatio"
  | "debtToTurnover";

/** ok = full points, partial = some points, fail = none, needsNumbers = cannot check without the calculator. */
export type CheckStatus = "ok" | "partial" | "fail" | "needsNumbers";

export type PlanCheck = {
  id: CheckId;
  status: CheckStatus;
  points: number;
  max: number;
  /** Numbers for the explanation text (ratios as plain numbers, shares as 0–1). */
  values: Record<string, number | string | null>;
  /** Where the bank threshold comes from. */
  sourceUrl?: string;
  /** For "sections": the first section without text, to link to. */
  firstMissing?: BankLoanSection;
};

const MAX_POINTS: Record<CheckId, number> = {
  sections: 2 * bankLoanSections.length, // 22
  numbers: 6,
  dscr: 10,
  cash: 8,
  ownContribution: 6,
  equity: 4,
  currentRatio: 2,
  debtToTurnover: 2,
};

const check = (id: CheckId, status: CheckStatus, points: number, values: PlanCheck["values"] = {}, sourceUrl?: string): PlanCheck => ({
  id,
  status,
  points,
  max: MAX_POINTS[id],
  values,
  ...(sourceUrl ? { sourceUrl } : {}),
});

const lowest = (values: (number | null)[]) => {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? Math.min(...known) : null;
};

export function checkPlan(answers: PlanAnswers, rawFinance: unknown, companyType: CompanyType): PlanCheck[] {
  const checks: PlanCheck[] = [];

  // 1. Written sections: 2 points each.
  const written = bankLoanSections.filter((section) => answers[section]?.text.trim());
  const firstMissing = bankLoanSections.find((section) => !answers[section]?.text.trim());
  checks.push({
    ...check(
      "sections",
      written.length === bankLoanSections.length ? "ok" : written.length > 0 ? "partial" : "fail",
      2 * written.length,
      { done: written.length, total: bankLoanSections.length },
    ),
    ...(firstMissing ? { firstMissing } : {}),
  });

  // 2. Sales forecast and loan entered in the calculator.
  const inputs = filledFinanceInputs(rawFinance);
  const hasSales = Boolean(inputs?.revenue.some((line) => line.year1.some((v) => v > 0) || line.year2Total > 0 || line.year3Total > 0));
  const hasLoan = Boolean(inputs && inputs.loan.amount > 0);
  checks.push(
    check("numbers", hasSales && hasLoan ? "ok" : hasSales || hasLoan ? "partial" : "fail", hasSales && hasLoan ? 6 : hasSales || hasLoan ? 3 : 0, {
      hasSales: hasSales ? 1 : 0,
      hasLoan: hasLoan ? 1 : 0,
    }),
  );

  const financial: CheckId[] = ["dscr", "cash", "ownContribution", "equity", "currentRatio", "debtToTurnover"];
  if (!inputs || !hasSales || !hasLoan) {
    for (const id of financial) checks.push(check(id, "needsNumbers", 0));
    return checks;
  }

  const result = calculateProjection(inputs, companyType);
  const years = result.years;

  // 3. Can the business pay the loan? Lowest DSCR in the three years.
  //    Below 1.0 the business cannot cover the payments at all, so 1.0 earns half points.
  const minDscr = benchmarks.minDscr.value;
  const dscr = lowest(years.map((y) => y.ratios.dscr));
  if (dscr === null) {
    checks.push(check("dscr", "needsNumbers", 0));
  } else {
    const [status, points]: [CheckStatus, number] = dscr >= minDscr ? ["ok", 10] : dscr >= 1 ? ["partial", 5] : ["fail", 0];
    checks.push(check("dscr", status, points, { value: dscr, minimum: minDscr }, benchmarks.minDscr.sources[0].url));
  }

  // 4. Money never runs out in the 36 months.
  const lowestCash = Math.min(...result.months.map((m) => m.closingCash));
  const firstNegative = result.months.find((m) => m.closingCash < 0);
  checks.push(
    check("cash", lowestCash >= 0 ? "ok" : "fail", lowestCash >= 0 ? 8 : 0, {
      lowest: lowestCash,
      month: firstNegative?.month ?? null,
    }),
  );

  // 5. Own money as a share of the project cost (own money + loan).
  const target = benchmarks.ownContributionTarget.value;
  const share = inputs.ownContribution / (inputs.ownContribution + inputs.loan.amount);
  checks.push(
    check(
      "ownContribution",
      share >= target.good ? "ok" : share >= target.minimum ? "partial" : "fail",
      share >= target.good ? 6 : share >= target.minimum ? 3 : 0,
      { share, good: target.good, minimum: target.minimum },
      benchmarks.ownContributionTarget.sources[0].url,
    ),
  );

  // 6. Equity share of the balance sheet, lowest of the three year ends.
  const minEquity = benchmarks.minEquityRatio.value;
  const equity = lowest(years.map((y) => y.ratios.equityRatio));
  checks.push(
    check("equity", equity !== null && equity >= minEquity ? "ok" : "fail", equity !== null && equity >= minEquity ? 4 : 0, { value: equity, minimum: minEquity }, benchmarks.minEquityRatio.sources[0].url),
  );

  // 7. Short-term bills covered. No short-term liabilities at all counts as fine.
  const minCurrent = benchmarks.minCurrentRatio.value;
  const current = lowest(years.map((y) => y.ratios.currentRatio));
  const currentOk = current === null || current >= minCurrent;
  checks.push(check("currentRatio", currentOk ? "ok" : "fail", currentOk ? 2 : 0, { value: current, minimum: minCurrent }, benchmarks.minCurrentRatio.sources[0].url));

  // 8. Debt compared with yearly sales, highest of the three years.
  const maxDebt = benchmarks.maxDebtToTurnover.value;
  const debtValues = years.map((y) => y.ratios.debtToTurnover).filter((v): v is number => v !== null);
  const debt = debtValues.length === years.length ? Math.max(...debtValues) : null; // null: a year without sales
  const debtOk = debt !== null && debt <= maxDebt;
  checks.push(check("debtToTurnover", debtOk ? "ok" : "fail", debtOk ? 2 : 0, { value: debt, maximum: maxDebt }, benchmarks.maxDebtToTurnover.sources[0].url));

  return checks;
}

// ---------------------------------------------------------------------------
// Interview and total
// ---------------------------------------------------------------------------

export const ratings = ["strong", "ok", "weak"] as const;
export type Rating = (typeof ratings)[number];
const RATING_SHARE: Record<Rating, number> = { strong: 1, ok: 0.5, weak: 0 };

/** Interview points: each question weighs the same; an unanswered or unrated question gives 0. */
export function interviewPoints(questionRatings: (Rating | null)[]): number {
  if (questionRatings.length === 0) return 0;
  const earned = questionRatings.reduce((sum, r) => sum + (r ? RATING_SHARE[r] : 0), 0);
  return Math.round((earned / questionRatings.length) * INTERVIEW_MAX);
}

export type ReadinessLevel = "notReady" | "almost" | "ready";

export function readinessScore(checks: PlanCheck[], questionRatings: (Rating | null)[]) {
  const plan = checks.reduce((sum, c) => sum + c.points, 0);
  const interview = interviewPoints(questionRatings);
  const total = plan + interview;
  const level: ReadinessLevel = total >= 75 ? "ready" : total >= 50 ? "almost" : "notReady";
  return { plan, interview, total, level };
}
