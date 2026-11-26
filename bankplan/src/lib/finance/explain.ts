/**
 * "How is this calculated?" — step-by-step explanations of the forecast, using the user's own numbers.
 *
 * Nothing is calculated twice in a different way: every step either reads the projection result
 * or calls the same functions the projection uses (payslip, loan schedule, dividend tax, FIE taxes).
 * The steps are language-neutral (a text key plus numbers); the screen turns them into sentences.
 */
import { estonia, type CompanyType } from "@/config/countries/ee";
import type { Rule, Source } from "@/config/types";
import { dividendTax } from "./ee/company";
import { monthlyPayslip } from "./ee/payroll";
import type { FinanceInputs } from "./inputs";
import { loanSchedule } from "./loan";
import { round2, sum } from "./money";
import type { ProjectionResult, YearResult } from "./projection";
import { periodAt } from "./rules";

export type ExplainValue = { kind: "eur" | "percent" | "ratio" | "number"; value: number };

export type ExplainStep = { key: StepKey; values: Record<string, ExplainValue> };

export type TopicId =
  | "payroll"
  | "loan"
  | "vat"
  | "dividendTax"
  | "fieTaxes"
  | "depreciation"
  | "dscr"
  | "breakEven"
  | "equityRatio"
  | "currentRatio";

export type ExplainTopic = {
  id: TopicId;
  /** Text the user typed for this item (staff role, investment name), shown in the title. */
  subject?: string;
  steps: ExplainStep[];
  /** Official sources of the rules used in the steps. */
  sources: Source[];
};

/** Every step text key; the sentences live in messages under finance.explain.steps. */
export const STEP_KEYS = [
  "payGross",
  "payMinimumBase",
  "paySocialTax",
  "payUnemploymentEmployer",
  "payNoUnemployment",
  "payEmployerCost",
  "payCount",
  "payUnemploymentEmployee",
  "payPension",
  "payTaxable",
  "payIncomeTax",
  "payNet",
  "loanRate",
  "loanGrace",
  "loanAnnuity",
  "loanEqualPrincipal",
  "loanFirst",
  "loanTotalInterest",
  "loanFee",
  "vatRates",
  "vatSales",
  "vatPurchases",
  "vatToPay",
  "vatRefund",
  "vatWhen",
  "vatNotRegistered",
  "vatThreshold",
  "divNone",
  "divTax",
  "divRetained",
  "divOwner",
  "fieProfit",
  "fieSocialTax",
  "fieSocialTaxMinimum",
  "fieSocialTaxMaximum",
  "fieTaxable",
  "fiePension",
  "fieExemption",
  "fieIncomeTax",
  "fieTotal",
  "fieWhen",
  "depCost",
  "depCostWithVat",
  "depPerYear",
  "depMeaning",
  "dscrEbitda",
  "dscrTaxes",
  "dscrDrawings",
  "dscrAvailable",
  "dscrDebtService",
  "dscrResult",
  "dscrMeaning",
  "beFixed",
  "beMargin",
  "beResult",
  "eqEquity",
  "eqResult",
  "crAssets",
  "crLiabilities",
  "crResult",
] as const;
export type StepKey = (typeof STEP_KEYS)[number];

/** At most this many staff lines and investments get their own explanation. */
const MAX_ITEMS = 3;

const eur = (value: number): ExplainValue => ({ kind: "eur", value: round2(value) });
const pct = (value: number): ExplainValue => ({ kind: "percent", value });
const ratio = (value: number): ExplainValue => ({ kind: "ratio", value });
const num = (value: number): ExplainValue => ({ kind: "number", value });

/** Sources without repeats (same address and reference). */
function uniqueSources(lists: Source[][]): Source[] {
  const seen = new Set<string>();
  return lists.flat().filter((source) => {
    const key = `${source.url}|${source.ref ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** "YYYY-MM-01" of a forecast month (0-based offset from the start month). */
function monthDate(startMonth: string, offset: number): string {
  const [year, month] = startMonth.split("-").map(Number);
  const zeroBased = month - 1 + offset;
  const calYear = year + Math.floor(zeroBased / 12);
  return `${calYear}-${String((zeroBased % 12) + 1).padStart(2, "0")}-01`;
}

/** A rule's value on a day, with the sources that confirm it. */
function rate<T>(rule: Rule<T>, date: string) {
  const period = periodAt(rule, date);
  return { value: period.value, sources: period.sources };
}

/** One person's monthly pay in the month they start, the same way the projection works it out. */
function explainPayroll(inputs: FinanceInputs, companyType: CompanyType): ExplainTopic[] {
  const ee = estonia;
  return inputs.staff.slice(0, MAX_ITEMS).map((line) => {
    const offset = line.startMonth - 1;
    const date = monthDate(inputs.startMonth, offset);
    const planYear = Math.floor(offset / 12) + 1;
    const gross = line.grossMonthly * Math.pow(1 + inputs.wageGrowthPercent / 100, planYear - 1);
    const isBoardMember = companyType !== "FIE" && line.kind === "boardMember";
    const options = isBoardMember
      ? {
          applyMinimumSocialTax: ee.boardMember.socialTaxMinimum.value,
          unemploymentInsurance: ee.boardMember.unemploymentInsurance.value,
        }
      : { applyMinimumSocialTax: line.minimumSocialTax, unemploymentInsurance: true };

    const r = {
      incomeTax: rate(ee.payroll.incomeTaxRate, date),
      exemption: rate(ee.payroll.basicExemptionMonthly, date),
      socialTax: rate(ee.payroll.socialTaxRate, date),
      minBase: rate(ee.payroll.socialTaxMonthlyMinBase, date),
      unemploymentEmployee: rate(ee.payroll.unemploymentInsuranceEmployee, date),
      unemploymentEmployer: rate(ee.payroll.unemploymentInsuranceEmployer, date),
      pension: rate(ee.payroll.fundedPensionDefaultRate, date),
      payDay: rate(ee.paymentDays.payrollTaxes, date),
    };
    const slip = monthlyPayslip(gross, options, {
      incomeTax: r.incomeTax.value,
      exemptionMonthly: r.exemption.value,
      socialTax: r.socialTax.value,
      socialTaxMinBase: r.minBase.value,
      unemploymentEmployee: r.unemploymentEmployee.value,
      unemploymentEmployer: r.unemploymentEmployer.value,
      fundedPension: r.pension.value,
    });
    const usesMinimum = options.applyMinimumSocialTax && gross < r.minBase.value;
    const socialTaxBase = usesMinimum ? r.minBase.value : gross;
    const taxable = Math.max(0, gross - slip.unemploymentEmployee - slip.fundedPension - r.exemption.value);

    const steps: ExplainStep[] = [{ key: "payGross", values: { gross: eur(gross) } }];
    if (usesMinimum) steps.push({ key: "payMinimumBase", values: { minBase: eur(r.minBase.value) } });
    steps.push({
      key: "paySocialTax",
      values: { rate: pct(r.socialTax.value), base: eur(socialTaxBase), amount: eur(slip.socialTax) },
    });
    if (options.unemploymentInsurance) {
      steps.push({
        key: "payUnemploymentEmployer",
        values: { rate: pct(r.unemploymentEmployer.value), gross: eur(gross), amount: eur(slip.unemploymentEmployer) },
      });
    } else {
      steps.push({ key: "payNoUnemployment", values: {} });
    }
    steps.push({
      key: "payEmployerCost",
      values: {
        gross: eur(gross),
        socialTax: eur(slip.socialTax),
        unemployment: eur(slip.unemploymentEmployer),
        cost: eur(slip.employerCost),
      },
    });
    if (line.count > 1) {
      steps.push({ key: "payCount", values: { count: num(line.count), total: eur(slip.employerCost * line.count) } });
    }
    if (options.unemploymentInsurance) {
      steps.push({
        key: "payUnemploymentEmployee",
        values: { rate: pct(r.unemploymentEmployee.value), gross: eur(gross), amount: eur(slip.unemploymentEmployee) },
      });
    }
    steps.push({ key: "payPension", values: { rate: pct(r.pension.value), gross: eur(gross), amount: eur(slip.fundedPension) } });
    steps.push({
      key: "payTaxable",
      values: {
        gross: eur(gross),
        unemployment: eur(slip.unemploymentEmployee),
        pension: eur(slip.fundedPension),
        exemption: eur(r.exemption.value),
        taxable: eur(taxable),
      },
    });
    steps.push({ key: "payIncomeTax", values: { rate: pct(r.incomeTax.value), taxable: eur(taxable), amount: eur(slip.incomeTax) } });
    steps.push({ key: "payNet", values: { net: eur(slip.net), day: num(r.payDay.value) } });

    const topic: ExplainTopic = {
      id: "payroll",
      subject: line.role,
      steps,
      sources: uniqueSources([
        r.socialTax.sources,
        usesMinimum ? r.minBase.sources : [],
        options.unemploymentInsurance ? r.unemploymentEmployer.sources : ee.boardMember.unemploymentInsurance.sources,
        isBoardMember ? ee.boardMember.socialTaxMinimum.sources : [],
        r.pension.sources,
        ee.wageIncomeTaxBase.sources,
        r.exemption.sources,
        r.incomeTax.sources,
        r.payDay.sources,
      ]),
    };
    return topic;
  });
}

function explainLoan(inputs: FinanceInputs): ExplainTopic[] {
  const loan = inputs.loan;
  const schedule = loanSchedule({
    amount: loan.amount,
    annualRate: loan.annualInterestPercent / 100,
    termMonths: loan.termMonths,
    type: loan.type,
    graceMonths: loan.graceMonths,
  });
  if (schedule.length === 0) return [];
  const annual = loan.annualInterestPercent / 100;
  const repaymentMonths = loan.termMonths - loan.graceMonths;
  const first = schedule[loan.graceMonths];
  const balanceBefore = loan.amount;

  const steps: ExplainStep[] = [{ key: "loanRate", values: { annual: pct(annual), monthly: pct(annual / 12) } }];
  if (loan.graceMonths > 0) {
    steps.push({
      key: "loanGrace",
      values: { months: num(loan.graceMonths), interest: eur(schedule[0].interest) },
    });
  }
  if (loan.type === "annuity") {
    steps.push({
      key: "loanAnnuity",
      values: { amount: eur(loan.amount), months: num(repaymentMonths), payment: eur(first.payment) },
    });
  } else {
    steps.push({
      key: "loanEqualPrincipal",
      values: { amount: eur(loan.amount), months: num(repaymentMonths), principal: eur(first.principal) },
    });
  }
  steps.push({
    key: "loanFirst",
    values: {
      payment: eur(first.payment),
      balance: eur(balanceBefore),
      monthly: pct(annual / 12),
      interest: eur(first.interest),
      principal: eur(first.principal),
    },
  });
  steps.push({ key: "loanTotalInterest", values: { total: eur(sum(schedule.map((p) => p.interest))) } });
  if (loan.contractFeePercent > 0) {
    steps.push({
      key: "loanFee",
      values: {
        rate: pct(loan.contractFeePercent / 100),
        amount: eur(loan.amount),
        fee: eur((loan.amount * loan.contractFeePercent) / 100),
      },
    });
  }
  return [{ id: "loan", steps, sources: [] }];
}

function explainVat(inputs: FinanceInputs, year1: YearResult): ExplainTopic[] {
  const ee = estonia;
  const date = monthDate(inputs.startMonth, 0);
  const standard = rate(ee.vat.standardRate, date);
  const threshold = rate(ee.vat.registrationThreshold, date);
  if (!inputs.vatRegistered) {
    return [
      {
        id: "vat",
        steps: [
          { key: "vatNotRegistered", values: { rate: pct(standard.value) } },
          { key: "vatThreshold", values: { threshold: eur(threshold.value) } },
        ],
        sources: uniqueSources([standard.sources, threshold.sources]),
      },
    ];
  }
  const day = rate(ee.paymentDays.vat, date);
  const net = year1.vatOnSales - year1.vatOnPurchases;
  return [
    {
      id: "vat",
      steps: [
        { key: "vatRates", values: { rate: pct(standard.value) } },
        { key: "vatSales", values: { amount: eur(year1.vatOnSales) } },
        { key: "vatPurchases", values: { amount: eur(year1.vatOnPurchases) } },
        net >= 0
          ? { key: "vatToPay", values: { sales: eur(year1.vatOnSales), purchases: eur(year1.vatOnPurchases), net: eur(net) } }
          : { key: "vatRefund", values: { sales: eur(year1.vatOnSales), purchases: eur(year1.vatOnPurchases), net: eur(-net) } },
        { key: "vatWhen", values: { day: num(day.value) } },
      ],
      sources: uniqueSources([standard.sources, day.sources]),
    },
  ];
}

function explainDividendTax(inputs: FinanceInputs): ExplainTopic[] {
  const ee = estonia;
  const yearIndex = inputs.dividends.findIndex((amount) => amount > 0);
  // Dividends are paid in the last month of each plan year.
  const date = monthDate(inputs.startMonth, Math.max(yearIndex, 0) * 12 + 11);
  const taxRate = rate(ee.corporate.distributionTaxRate, date);
  const divisor = rate(ee.corporate.distributionGrossUpDivisor, date);
  const retained = rate(ee.corporate.taxOnRetainedProfit, date);
  const owner = rate(ee.corporate.dividendTaxForResidentOwner, date);
  const sources = uniqueSources([taxRate.sources, divisor.sources, retained.sources, owner.sources]);

  if (yearIndex < 0) return [{ id: "dividendTax", steps: [{ key: "divNone", values: {} }], sources }];
  const dividend = inputs.dividends[yearIndex];
  return [
    {
      id: "dividendTax",
      steps: [
        {
          key: "divTax",
          values: {
            year: num(yearIndex + 1),
            dividend: eur(dividend),
            divisor: num(divisor.value),
            rate: pct(taxRate.value),
            tax: eur(dividendTax(dividend, taxRate.value, divisor.value)),
          },
        },
        { key: "divRetained", values: {} },
        { key: "divOwner", values: {} },
      ],
      sources,
    },
  ];
}

/** FIE owner's taxes for the first calendar year of the forecast, as the projection works them out. */
function explainFieTaxes(inputs: FinanceInputs, result: ProjectionResult): ExplainTopic[] {
  const ee = estonia;
  const taxYear = result.fieTaxYears[0];
  if (!taxYear) return [];
  const dates = Array.from({ length: 36 }, (_, i) => monthDate(inputs.startMonth, i)).filter((d) =>
    d.startsWith(String(taxYear.calendarYear)),
  );
  const first = dates[0];
  const socialTax = rate(ee.payroll.socialTaxRate, first);
  const divisor = rate(ee.soleProprietor.incomeTaxSocialTaxDivisor, first);
  const maxMultiple = rate(ee.soleProprietor.socialTaxMaxBaseMinimumWages, first);
  const incomeTax = rate(ee.payroll.incomeTaxRate, first);
  const exemptionYear = rate(ee.payroll.basicExemptionYearly, first);
  const pension = rate(ee.soleProprietor.fundedPensionOnOwnIncome, first);
  const minBaseSum = sum(dates.map((d) => periodAt(ee.payroll.socialTaxMonthlyMinBase, d).value));
  const minimumWageSum = sum(dates.map((d) => periodAt(ee.payroll.minimumWageMonthly, d).value));

  const normal = round2((Math.max(taxYear.profit, 0) / divisor.value) * socialTax.value);
  const minimum = round2(minBaseSum * socialTax.value);
  const maximum = round2(maxMultiple.value * minimumWageSum * socialTax.value);
  const exemption = inputs.useBasicExemption ? (exemptionYear.value * dates.length) / 12 : 0;
  const pensionRate = inputs.fundedPensionPercent / 100;

  const steps: ExplainStep[] = [
    { key: "fieProfit", values: { year: num(taxYear.calendarYear), months: num(taxYear.months), profit: eur(taxYear.profit) } },
    {
      key: "fieSocialTax",
      values: { profit: eur(Math.max(taxYear.profit, 0)), divisor: num(divisor.value), rate: pct(socialTax.value), amount: eur(normal) },
    },
  ];
  if (taxYear.socialTax === minimum && normal < minimum) {
    steps.push({ key: "fieSocialTaxMinimum", values: { months: num(dates.length), minimum: eur(minimum) } });
  } else if (taxYear.socialTax === maximum && normal > maximum) {
    steps.push({ key: "fieSocialTaxMaximum", values: { maximum: eur(maximum) } });
  }
  steps.push({
    key: "fieTaxable",
    values: { profit: eur(taxYear.profit), socialTax: eur(taxYear.socialTax), taxable: eur(taxYear.taxableIncome) },
  });
  if (pensionRate > 0) {
    steps.push({ key: "fiePension", values: { rate: pct(pensionRate), taxable: eur(taxYear.taxableIncome), amount: eur(taxYear.fundedPension) } });
  }
  steps.push({ key: "fieExemption", values: { amount: eur(exemption) } });
  steps.push({
    key: "fieIncomeTax",
    values: {
      rate: pct(incomeTax.value),
      taxable: eur(taxYear.taxableIncome),
      pension: eur(taxYear.fundedPension),
      exemption: eur(exemption),
      amount: eur(taxYear.incomeTax),
    },
  });
  steps.push({ key: "fieTotal", values: { total: eur(taxYear.total) } });
  steps.push({ key: "fieWhen", values: {} });

  return [
    {
      id: "fieTaxes",
      steps,
      sources: uniqueSources([
        socialTax.sources,
        divisor.sources,
        periodAt(ee.soleProprietor.socialTaxMinBaseMonths, first).sources,
        maxMultiple.sources,
        pensionRate > 0 ? pension.sources : [],
        exemptionYear.sources,
        incomeTax.sources,
      ]),
    },
  ];
}

function explainDepreciation(inputs: FinanceInputs): ExplainTopic[] {
  const date = monthDate(inputs.startMonth, 0);
  const vatRate = periodAt(estonia.vat.standardRate, date).value;
  return inputs.investments
    .filter((item) => item.amount > 0)
    .slice(0, MAX_ITEMS)
    .map((item) => {
      const withVat = !inputs.vatRegistered && item.hasVat;
      const cost = withVat ? item.amount * (1 + vatRate) : item.amount;
      const costStep: ExplainStep = withVat
        ? { key: "depCostWithVat", values: { amount: eur(item.amount), rate: pct(vatRate), cost: eur(cost) } }
        : { key: "depCost", values: { cost: eur(cost) } };
      const topic: ExplainTopic = {
        id: "depreciation",
        subject: item.name,
        steps: [
          costStep,
          {
            key: "depPerYear",
            values: {
              cost: eur(cost),
              years: num(item.lifeYears),
              perYear: eur(cost / item.lifeYears),
              perMonth: eur(cost / item.lifeYears / 12),
            },
          },
          { key: "depMeaning", values: {} },
        ],
        sources: [],
      };
      return topic;
    });
}

function explainRatios(result: ProjectionResult, inputs: FinanceInputs, companyType: CompanyType): ExplainTopic[] {
  const ee = estonia;
  const isFie = companyType === "FIE";
  const topics: ExplainTopic[] = [];
  const benchmarks = ee.bankBenchmarks;

  // DSCR: the first year with loan payments.
  const dscrYear = result.years.find((y) => y.ratios.dscr !== null);
  if (dscrYear) {
    const available = dscrYear.ebitda - dscrYear.incomeTaxes - (isFie ? dscrYear.toOwner : 0);
    const service = dscrYear.loanPrincipalPaid + dscrYear.interestPaid;
    const steps: ExplainStep[] = [
      { key: "dscrEbitda", values: { year: num(dscrYear.year), ebitda: eur(dscrYear.ebitda) } },
      { key: "dscrTaxes", values: { taxes: eur(dscrYear.incomeTaxes) } },
    ];
    if (isFie) steps.push({ key: "dscrDrawings", values: { drawings: eur(dscrYear.toOwner) } });
    steps.push(
      { key: "dscrAvailable", values: { available: eur(available) } },
      {
        key: "dscrDebtService",
        values: { principal: eur(dscrYear.loanPrincipalPaid), interest: eur(dscrYear.interestPaid), service: eur(service) },
      },
      {
        key: "dscrResult",
        values: {
          available: eur(available),
          service: eur(service),
          dscr: ratio(dscrYear.ratios.dscr!),
          minimum: ratio(benchmarks.minDscr.value),
        },
      },
      { key: "dscrMeaning", values: { dscr: ratio(dscrYear.ratios.dscr!) } },
    );
    topics.push({ id: "dscr", steps, sources: benchmarks.minDscr.sources });
  }

  const y = result.years[0];
  if (y.ratios.breakEvenRevenue !== null) {
    const interestAndFees = y.interest + y.loanFees;
    const fixed = y.operatingCosts + y.wages + y.employerTaxes + y.depreciation + interestAndFees;
    const margin = y.grossProfit / y.revenue;
    topics.push({
      id: "breakEven",
      steps: [
        {
          key: "beFixed",
          values: {
            year: num(y.year),
            operating: eur(y.operatingCosts),
            wages: eur(y.wages),
            employerTaxes: eur(y.employerTaxes),
            depreciation: eur(y.depreciation),
            interest: eur(interestAndFees),
            fixed: eur(fixed),
          },
        },
        { key: "beMargin", values: { margin: pct(margin), grossProfit: eur(y.grossProfit), revenue: eur(y.revenue) } },
        {
          key: "beResult",
          values: { fixed: eur(fixed), margin: pct(margin), breakEven: eur(y.ratios.breakEvenRevenue), revenue: eur(y.revenue) },
        },
      ],
      sources: [],
    });
  }

  if (y.ratios.equityRatio !== null) {
    const profitSoFar = sum(result.years.filter((r) => r.year <= y.year).map((r) => r.netProfit));
    const paidSoFar = sum(result.years.filter((r) => r.year <= y.year).map((r) => r.toOwner));
    topics.push({
      id: "equityRatio",
      steps: [
        {
          key: "eqEquity",
          values: {
            year: num(y.year),
            own: eur(inputs.ownContribution),
            profit: eur(profitSoFar),
            paid: eur(paidSoFar),
            equity: eur(y.balance.equity),
          },
        },
        {
          key: "eqResult",
          values: {
            equity: eur(y.balance.equity),
            assets: eur(y.balance.totalAssets),
            ratio: pct(y.ratios.equityRatio),
            minimum: pct(benchmarks.minEquityRatio.value),
          },
        },
      ],
      sources: benchmarks.minEquityRatio.sources,
    });
  }

  if (y.ratios.currentRatio !== null) {
    const b = y.balance;
    const assets = b.cash + b.receivables + b.taxReceivable;
    const liabilities = b.taxPayable + b.loanCurrent;
    topics.push({
      id: "currentRatio",
      steps: [
        {
          key: "crAssets",
          values: {
            year: num(y.year),
            cash: eur(b.cash),
            receivables: eur(b.receivables),
            taxReceivable: eur(b.taxReceivable),
            total: eur(assets),
          },
        },
        { key: "crLiabilities", values: { taxPayable: eur(b.taxPayable), loanCurrent: eur(b.loanCurrent), total: eur(liabilities) } },
        {
          key: "crResult",
          values: {
            assets: eur(assets),
            liabilities: eur(liabilities),
            ratio: ratio(y.ratios.currentRatio),
            minimum: ratio(benchmarks.minCurrentRatio.value),
          },
        },
      ],
      sources: benchmarks.minCurrentRatio.sources,
    });
  }
  return topics;
}

/** All explanations for a forecast, in the order the screen shows them. */
export function explainCalculations(
  inputs: FinanceInputs,
  companyType: CompanyType,
  result: ProjectionResult,
): ExplainTopic[] {
  return [
    ...explainRatios(result, inputs, companyType),
    ...explainPayroll(inputs, companyType),
    ...explainLoan(inputs),
    ...explainVat(inputs, result.years[0]),
    ...(companyType === "FIE" ? explainFieTaxes(inputs, result) : explainDividendTax(inputs)),
    ...explainDepreciation(inputs),
  ];
}
