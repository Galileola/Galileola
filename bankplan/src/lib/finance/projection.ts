/**
 * The 3-year forecast for an Estonian OÜ or FIE.
 *
 * How it works, in plain words:
 * 1. Everything is worked out month by month for 36 months.
 * 2. The profit and loss view counts things when they happen (sales, costs, taxes).
 *    The cash view counts them when money moves (customers pay later, taxes are paid next month).
 * 3. The yearly results, balance sheet and bank ratios are built from the monthly figures.
 *
 * All rates come from config/countries/ee.ts. Assumptions made here (not set by law):
 * - Purchases (goods, costs with VAT, investments) carry the standard VAT rate.
 * - Suppliers and staff are paid in the same month; payroll taxes and VAT the next month
 *   (VAT refunds also arrive the next month).
 * - Loan payments start one month after the money is paid out.
 * - OÜ dividends are paid in the last month of each plan year; their tax the month after.
 * - FIE taxes are worked out per calendar year. For a year only partly inside the forecast,
 *   the minimum, maximum and tax-free amounts are scaled to those months.
 */
import { estonia, type CompanyType } from "@/config/countries/ee";
import { dividendTax } from "./ee/company";
import { monthlyPayslip } from "./ee/payroll";
import { fieYearTaxes, type FieYearTaxes } from "./ee/soleProprietor";
import type { FinanceInputs } from "./inputs";
import { loanSchedule, type LoanPayment } from "./loan";
import { round2, sum } from "./money";
import { RuleReader, type Assumption } from "./rules";

export const FORECAST_MONTHS = 36;

export type MonthResult = {
  /** 1–36 */
  index: number;
  /** "YYYY-MM" */
  month: string;
  planYear: 1 | 2 | 3;
  // Profit and loss (without VAT)
  revenue: number;
  directCosts: number;
  operatingCosts: number;
  wages: number;
  employerTaxes: number;
  ebitda: number;
  depreciation: number;
  interest: number;
  loanFees: number;
  /** OÜ: tax on dividends. FIE: the owner's social tax, income tax and funded pension. */
  incomeTaxes: number;
  netProfit: number;
  // Cash (money in and out of the bank account)
  cashFromSales: number;
  cashFromLoan: number;
  cashFromOwner: number;
  cashToSuppliers: number;
  cashToStaff: number;
  cashPayrollTaxes: number;
  /** Positive = VAT paid, negative = VAT refunded. */
  cashVat: number;
  cashInvestments: number;
  cashLoanPrincipal: number;
  cashInterestAndFees: number;
  cashIncomeTaxes: number;
  /** OÜ: dividends. FIE: owner's drawings. */
  cashToOwner: number;
  netCashFlow: number;
  openingCash: number;
  closingCash: number;
};

export type BalanceSheet = {
  cash: number;
  receivables: number;
  taxReceivable: number;
  fixedAssets: number;
  totalAssets: number;
  taxPayable: number;
  /** Loan principal due in the next 12 months. */
  loanCurrent: number;
  loanLongTerm: number;
  totalLiabilities: number;
  equity: number;
};

export type YearRatios = {
  /** (EBITDA − income taxes − FIE owner's drawings) ÷ (loan principal + interest paid). Null if nothing was paid. */
  dscr: number | null;
  /** Current assets ÷ short-term liabilities. */
  currentRatio: number | null;
  /** Equity ÷ total assets. */
  equityRatio: number | null;
  /** Loan balance ÷ yearly revenue. */
  debtToTurnover: number | null;
  /** Revenue needed to cover all fixed costs, given this year's gross margin. */
  breakEvenRevenue: number | null;
};

export type YearResult = {
  year: 1 | 2 | 3;
  firstMonth: string;
  lastMonth: string;
  revenue: number;
  directCosts: number;
  grossProfit: number;
  operatingCosts: number;
  wages: number;
  employerTaxes: number;
  ebitda: number;
  depreciation: number;
  interest: number;
  loanFees: number;
  incomeTaxes: number;
  netProfit: number;
  toOwner: number;
  loanPrincipalPaid: number;
  interestPaid: number;
  cashIn: number;
  cashOut: number;
  closingCash: number;
  lowestCash: number;
  balance: BalanceSheet;
  ratios: YearRatios;
};

export type FieTaxYear = FieYearTaxes & { calendarYear: number; months: number; profit: number };

export type ScheduledPayment = LoanPayment & { month: string };

export type Warning =
  | { code: "negativeCash"; month: string; lowestCash: number }
  | { code: "lowDscr"; year: number; value: number; minimum: number }
  | { code: "lowCurrentRatio"; year: number; value: number; minimum: number }
  | { code: "lowEquityRatio"; year: number; value: number; minimum: number }
  | { code: "highDebtToTurnover"; year: number; value: number; maximum: number }
  | { code: "vatRegistrationNeeded"; calendarYear: number; turnover: number; threshold: number }
  | { code: "dividendsAboveProfit"; year: number };

export type ProjectionResult = {
  months: MonthResult[];
  years: YearResult[];
  loanSchedule: ScheduledPayment[];
  fieTaxYears: FieTaxYear[];
  warnings: Warning[];
  assumptions: Assumption[];
};

type MonthInfo = { calYear: number; calMonth: number; ym: string; date: string; planYear: 1 | 2 | 3 };

function monthInfo(startMonth: string, offset: number): MonthInfo {
  const [startYear, startMonthNumber] = startMonth.split("-").map(Number);
  const zeroBased = startMonthNumber - 1 + offset;
  const calYear = startYear + Math.floor(zeroBased / 12);
  const calMonth = (zeroBased % 12) + 1;
  const ym = `${calYear}-${String(calMonth).padStart(2, "0")}`;
  const planYear = (Math.floor(offset / 12) + 1) as 1 | 2 | 3;
  return { calYear, calMonth, ym, date: `${ym}-01`, planYear };
}

export function calculateProjection(inputs: FinanceInputs, companyType: CompanyType): ProjectionResult {
  const N = FORECAST_MONTHS;
  const ee = estonia;
  const rules = new RuleReader();
  const isFie = companyType === "FIE";
  const months = Array.from({ length: N }, (_, i) => monthInfo(inputs.startMonth, i));
  const zeros = () => new Array<number>(N).fill(0);
  const vatRate = (i: number) => rules.read("vatStandardRate", ee.vat.standardRate, months[i].date);
  const growth = (percent: number, planYear: number) => Math.pow(1 + percent / 100, planYear - 1);

  // Profit and loss, month by month
  const revenue = zeros();
  const taxableRevenue = zeros();
  const directCosts = zeros();
  const operatingCosts = zeros();
  const wages = zeros();
  const employerTaxes = zeros();
  const depreciation = zeros();
  const interest = zeros();
  const loanFees = zeros();
  const incomeTaxes = zeros();
  // Amounts that are paid later or are not costs
  const outputVat = zeros();
  const inputVat = zeros();
  const payrollTaxesDue = zeros();
  const fixedAssetsBought = zeros();
  const loanPaidOut = zeros();
  const principal = zeros();
  const toOwner = zeros();
  // Cash
  const cashFromSales = zeros();
  const cashFromOwner = zeros();
  const cashToSuppliers = zeros();
  const cashToStaff = zeros();
  const cashPayrollTaxes = zeros();
  const cashVat = zeros();
  const cashInvestments = zeros();
  const cashIncomeTaxes = zeros();

  /** A purchase of goods or services: cost without VAT if the business can reclaim VAT. */
  function buy(i: number, amount: number, hasVat: boolean, costs: number[]) {
    const vat = hasVat ? amount * vatRate(i) : 0;
    cashToSuppliers[i] += amount + vat;
    if (inputs.vatRegistered) {
      costs[i] += amount;
      inputVat[i] += vat;
    } else {
      costs[i] += amount + vat;
    }
  }

  // 1. Sales and the goods/materials they need. Years 2–3 follow year 1's monthly pattern.
  for (const line of inputs.revenue) {
    const year1Total = sum(line.year1);
    const pattern = line.year1.map((value) => (year1Total > 0 ? value / year1Total : 1 / 12));
    for (let i = 0; i < N; i++) {
      const { planYear } = months[i];
      const amount =
        planYear === 1 ? line.year1[i % 12] : (planYear === 2 ? line.year2Total : line.year3Total) * pattern[i % 12];
      revenue[i] += amount;
      if (line.vatPercent > 0) taxableRevenue[i] += amount;
      if (inputs.vatRegistered) outputVat[i] += (amount * line.vatPercent) / 100;
      buy(i, (amount * line.directCostPercent) / 100, true, directCosts);
    }
  }

  // 2. Running costs, growing each plan year.
  for (const line of inputs.costs) {
    for (let i = 0; i < N; i++) {
      buy(i, line.monthly * growth(inputs.costGrowthPercent, months[i].planYear), line.hasVat, operatingCosts);
    }
  }

  // 3. Staff. An FIE has no board, so everyone counts as an employee.
  for (const line of inputs.staff) {
    const isBoardMember = !isFie && line.kind === "boardMember";
    const options = isBoardMember
      ? {
          applyMinimumSocialTax: ee.boardMember.socialTaxMinimum.value,
          unemploymentInsurance: ee.boardMember.unemploymentInsurance.value,
        }
      : { applyMinimumSocialTax: line.minimumSocialTax, unemploymentInsurance: true };

    for (let i = line.startMonth - 1; i < N; i++) {
      const date = months[i].date;
      const gross = line.grossMonthly * growth(inputs.wageGrowthPercent, months[i].planYear);
      const slip = monthlyPayslip(gross, options, {
        incomeTax: rules.read("incomeTaxRate", ee.payroll.incomeTaxRate, date),
        exemptionMonthly: rules.read("basicExemptionMonthly", ee.payroll.basicExemptionMonthly, date),
        socialTax: rules.read("socialTaxRate", ee.payroll.socialTaxRate, date),
        socialTaxMinBase: rules.read("socialTaxMonthlyMinBase", ee.payroll.socialTaxMonthlyMinBase, date),
        unemploymentEmployee: rules.read("unemploymentInsurance", ee.payroll.unemploymentInsuranceEmployee, date),
        unemploymentEmployer: rules.read("unemploymentInsurance", ee.payroll.unemploymentInsuranceEmployer, date),
        fundedPension: rules.read("fundedPension", ee.payroll.fundedPensionDefaultRate, date),
      });
      wages[i] += slip.gross * line.count;
      employerTaxes[i] += (slip.socialTax + slip.unemploymentEmployer) * line.count;
      cashToStaff[i] += slip.net * line.count;
      payrollTaxesDue[i] += (slip.withheld + slip.socialTax + slip.unemploymentEmployer) * line.count;
    }
  }

  // 4. Investments: paid when bought, written off evenly over their useful life.
  for (const item of inputs.investments) {
    const i = item.month - 1;
    const vat = item.hasVat ? item.amount * vatRate(i) : 0;
    const cost = inputs.vatRegistered ? item.amount : item.amount + vat;
    cashInvestments[i] += item.amount + vat;
    if (inputs.vatRegistered) inputVat[i] += vat;
    fixedAssetsBought[i] += cost;
    const lifeMonths = item.lifeYears * 12;
    for (let j = i; j < Math.min(N, i + lifeMonths); j++) depreciation[j] += cost / lifeMonths;
  }

  // 5. Owner's own money, in the first month.
  cashFromOwner[0] += inputs.ownContribution;

  // 6. Loan.
  const loan = inputs.loan;
  const payments = loanSchedule({
    amount: loan.amount,
    annualRate: loan.annualInterestPercent / 100,
    termMonths: loan.termMonths,
    type: loan.type,
    graceMonths: loan.graceMonths,
  });
  const loanStart = loan.disbursementMonth - 1;
  const scheduled: ScheduledPayment[] = payments.map((payment) => ({
    ...payment,
    month: monthInfo(inputs.startMonth, loanStart + payment.number).ym,
  }));
  if (payments.length > 0) {
    loanPaidOut[loanStart] = loan.amount;
    loanFees[loanStart] += round2((loan.amount * loan.contractFeePercent) / 100);
    for (const payment of payments) {
      const i = loanStart + payment.number;
      if (i < N) {
        interest[i] += payment.interest;
        principal[i] += payment.principal;
      }
    }
  }

  // 7. VAT and payroll taxes are paid the month after.
  for (let i = 0; i + 1 < N; i++) {
    cashVat[i + 1] += outputVat[i] - inputVat[i];
    cashPayrollTaxes[i + 1] += payrollTaxesDue[i];
  }

  // 8. Customers pay after the agreed delay.
  const salesWithVat = revenue.map((value, i) => value + outputVat[i]);
  for (let i = 0; i + inputs.salesPaymentDelayMonths < N; i++) {
    cashFromSales[i + inputs.salesPaymentDelayMonths] += salesWithVat[i];
  }

  // 9. Profit before the owner's / company's income tax.
  const profitBeforeTax = months.map(
    (_, i) =>
      revenue[i] -
      directCosts[i] -
      operatingCosts[i] -
      wages[i] -
      employerTaxes[i] -
      depreciation[i] -
      interest[i] -
      loanFees[i],
  );

  // 10. Income taxes and money paid to the owner.
  const fieTaxYears: FieTaxYear[] = [];
  if (!isFie) {
    inputs.dividends.forEach((dividend, yearIndex) => {
      if (dividend <= 0) return;
      const i = yearIndex * 12 + 11;
      const date = months[i].date;
      const tax = dividendTax(
        dividend,
        rules.read("distributionTaxRate", ee.corporate.distributionTaxRate, date),
        rules.read("distributionGrossUpDivisor", ee.corporate.distributionGrossUpDivisor, date),
      );
      toOwner[i] += dividend;
      incomeTaxes[i] += tax;
      if (i + 1 < N) cashIncomeTaxes[i + 1] += tax;
    });
  } else {
    for (let i = 0; i < N; i++) toOwner[i] += inputs.ownerDrawingsMonthly;
    fieTaxYears.push(...calculateFieTaxes(inputs, months, profitBeforeTax, incomeTaxes, cashIncomeTaxes, rules));
  }

  // 11. Put the months together.
  const monthResults: MonthResult[] = [];
  let openingCash = 0;
  for (let i = 0; i < N; i++) {
    const ebitda = revenue[i] - directCosts[i] - operatingCosts[i] - wages[i] - employerTaxes[i];
    const cashIn = cashFromSales[i] + loanPaidOut[i] + cashFromOwner[i];
    const cashOut =
      cashToSuppliers[i] +
      cashToStaff[i] +
      cashPayrollTaxes[i] +
      cashVat[i] +
      cashInvestments[i] +
      principal[i] +
      interest[i] +
      loanFees[i] +
      cashIncomeTaxes[i] +
      toOwner[i];
    const closingCash = openingCash + cashIn - cashOut;
    monthResults.push({
      index: i + 1,
      month: months[i].ym,
      planYear: months[i].planYear,
      revenue: revenue[i],
      directCosts: directCosts[i],
      operatingCosts: operatingCosts[i],
      wages: wages[i],
      employerTaxes: employerTaxes[i],
      ebitda,
      depreciation: depreciation[i],
      interest: interest[i],
      loanFees: loanFees[i],
      incomeTaxes: incomeTaxes[i],
      netProfit: profitBeforeTax[i] - incomeTaxes[i],
      cashFromSales: cashFromSales[i],
      cashFromLoan: loanPaidOut[i],
      cashFromOwner: cashFromOwner[i],
      cashToSuppliers: cashToSuppliers[i],
      cashToStaff: cashToStaff[i],
      cashPayrollTaxes: cashPayrollTaxes[i],
      cashVat: cashVat[i],
      cashInvestments: cashInvestments[i],
      cashLoanPrincipal: principal[i],
      cashInterestAndFees: interest[i] + loanFees[i],
      cashIncomeTaxes: cashIncomeTaxes[i],
      cashToOwner: toOwner[i],
      netCashFlow: cashIn - cashOut,
      openingCash,
      closingCash,
    });
    openingCash = closingCash;
  }

  // 12. Years, balance sheets and ratios.
  const upTo = (values: number[], last: number) => sum(values.slice(0, last + 1));
  const benchmarks = ee.bankBenchmarks;
  const years: YearResult[] = ([1, 2, 3] as const).map((year) => {
    const first = (year - 1) * 12;
    const last = first + 11;
    const rows = monthResults.slice(first, last + 1);
    const total = (key: keyof MonthResult) => sum(rows.map((row) => row[key] as number));

    // Balance sheet at the end of the year.
    const cash = rows[rows.length - 1].closingCash;
    const receivables = upTo(salesWithVat, last) - upTo(cashFromSales, last);
    const fixedAssets = upTo(fixedAssetsBought, last) - upTo(depreciation, last);
    const taxBalance =
      upTo(outputVat, last) -
      upTo(inputVat, last) -
      upTo(cashVat, last) +
      upTo(payrollTaxesDue, last) -
      upTo(cashPayrollTaxes, last) +
      upTo(incomeTaxes, last) -
      upTo(cashIncomeTaxes, last);
    const loanBalance = upTo(loanPaidOut, last) - upTo(principal, last);
    const loanCurrent = Math.min(
      loanBalance,
      sum(payments.filter((p) => loanStart + p.number > last && loanStart + p.number <= last + 12).map((p) => p.principal)),
    );
    const equity =
      inputs.ownContribution + upTo(monthResults.map((m) => m.netProfit), last) - upTo(toOwner, last);
    const balance: BalanceSheet = {
      cash,
      receivables,
      taxReceivable: Math.max(0, -taxBalance),
      fixedAssets,
      totalAssets: cash + receivables + Math.max(0, -taxBalance) + fixedAssets,
      taxPayable: Math.max(0, taxBalance),
      loanCurrent,
      loanLongTerm: loanBalance - loanCurrent,
      totalLiabilities: Math.max(0, taxBalance) + loanBalance,
      equity,
    };

    const yearRevenue = total("revenue");
    const ebitda = total("ebitda");
    const yearIncomeTaxes = total("incomeTaxes");
    const yearToOwner = total("cashToOwner");
    const loanPrincipalPaid = total("cashLoanPrincipal");
    const interestPaid = total("interest");
    const debtService = loanPrincipalPaid + interestPaid;
    const fixedCosts =
      total("operatingCosts") + total("wages") + total("employerTaxes") + total("depreciation") + interestPaid + total("loanFees");
    const marginRatio = yearRevenue > 0 ? (yearRevenue - total("directCosts")) / yearRevenue : 0;
    const currentAssets = balance.cash + balance.receivables + balance.taxReceivable;
    const currentLiabilities = balance.taxPayable + balance.loanCurrent;

    return {
      year,
      firstMonth: rows[0].month,
      lastMonth: rows[rows.length - 1].month,
      revenue: yearRevenue,
      directCosts: total("directCosts"),
      grossProfit: yearRevenue - total("directCosts"),
      operatingCosts: total("operatingCosts"),
      wages: total("wages"),
      employerTaxes: total("employerTaxes"),
      ebitda,
      depreciation: total("depreciation"),
      interest: interestPaid,
      loanFees: total("loanFees"),
      incomeTaxes: yearIncomeTaxes,
      netProfit: total("netProfit"),
      toOwner: yearToOwner,
      loanPrincipalPaid,
      interestPaid,
      cashIn: total("cashFromSales") + total("cashFromLoan") + total("cashFromOwner"),
      cashOut:
        total("cashFromSales") + total("cashFromLoan") + total("cashFromOwner") - total("netCashFlow"),
      closingCash: cash,
      lowestCash: Math.min(...rows.map((row) => row.closingCash)),
      balance,
      ratios: {
        dscr: debtService > 0 ? (ebitda - yearIncomeTaxes - (isFie ? yearToOwner : 0)) / debtService : null,
        currentRatio: currentLiabilities > 0 ? currentAssets / currentLiabilities : null,
        equityRatio: balance.totalAssets > 0 ? balance.equity / balance.totalAssets : null,
        debtToTurnover: yearRevenue > 0 ? loanBalance / yearRevenue : null,
        breakEvenRevenue: marginRatio > 0 ? fixedCosts / marginRatio : null,
      },
    };
  });

  // 13. Warnings for the user (and later for the bank officer simulator).
  const warnings: Warning[] = [];
  const lowest = monthResults.reduce((low, row) => (row.closingCash < low.closingCash ? row : low));
  if (lowest.closingCash < 0) {
    const firstNegative = monthResults.find((row) => row.closingCash < 0)!;
    warnings.push({ code: "negativeCash", month: firstNegative.month, lowestCash: lowest.closingCash });
  }
  let distributedSoFar = 0;
  let profitSoFar = 0;
  for (const y of years) {
    const { dscr, currentRatio, equityRatio, debtToTurnover } = y.ratios;
    if (dscr !== null && dscr < benchmarks.minDscr.value)
      warnings.push({ code: "lowDscr", year: y.year, value: dscr, minimum: benchmarks.minDscr.value });
    if (currentRatio !== null && currentRatio < benchmarks.minCurrentRatio.value)
      warnings.push({ code: "lowCurrentRatio", year: y.year, value: currentRatio, minimum: benchmarks.minCurrentRatio.value });
    if (equityRatio !== null && equityRatio < benchmarks.minEquityRatio.value)
      warnings.push({ code: "lowEquityRatio", year: y.year, value: equityRatio, minimum: benchmarks.minEquityRatio.value });
    if (debtToTurnover !== null && debtToTurnover > benchmarks.maxDebtToTurnover.value)
      warnings.push({ code: "highDebtToTurnover", year: y.year, value: debtToTurnover, maximum: benchmarks.maxDebtToTurnover.value });
    if (!isFie) {
      distributedSoFar += y.toOwner;
      profitSoFar += y.netProfit;
      if (y.toOwner > 0 && distributedSoFar > profitSoFar) warnings.push({ code: "dividendsAboveProfit", year: y.year });
    }
  }
  if (!inputs.vatRegistered) {
    for (const calendarYear of [...new Set(months.map((m) => m.calYear))]) {
      const indexes = months.flatMap((m, i) => (m.calYear === calendarYear ? [i] : []));
      const turnover = sum(indexes.map((i) => taxableRevenue[i]));
      const threshold = rules.read("vatRegistrationThreshold", ee.vat.registrationThreshold, months[indexes[0]].date);
      if (turnover > threshold) warnings.push({ code: "vatRegistrationNeeded", calendarYear, turnover, threshold });
    }
  }

  return {
    months: monthResults,
    years,
    loanSchedule: scheduled,
    fieTaxYears,
    warnings,
    assumptions: rules.assumptions(),
  };
}

/**
 * FIE: the owner's taxes per calendar year, booked evenly over that year's months,
 * and the payments placed in the months the law sets.
 */
function calculateFieTaxes(
  inputs: FinanceInputs,
  months: MonthInfo[],
  profitBeforeTax: number[],
  incomeTaxes: number[],
  cashIncomeTaxes: number[],
  rules: RuleReader,
): FieTaxYear[] {
  const ee = estonia;
  const N = months.length;
  const schedule = ee.fieSchedule;
  const indexOf = (calYear: number, calMonth: number) =>
    months.findIndex((m) => m.calYear === calYear && m.calMonth === calMonth);
  const result: FieTaxYear[] = [];
  let previousIncomeTax: number | null = null;

  for (const calendarYear of [...new Set(months.map((m) => m.calYear))]) {
    const indexes = months.flatMap((m, i) => (m.calYear === calendarYear ? [i] : []));
    const firstDate = months[indexes[0]].date;
    const socialTaxRate = rules.read("socialTaxRate", ee.payroll.socialTaxRate, firstDate);
    const monthlyBases = indexes.map((i) =>
      rules.read("socialTaxMonthlyMinBase", ee.payroll.socialTaxMonthlyMinBase, months[i].date),
    );
    const profit = sum(indexes.map((i) => profitBeforeTax[i]));

    const taxes = fieYearTaxes({
      profit,
      socialTaxMinBaseSum: sum(monthlyBases),
      minimumWageSum: sum(
        indexes.map((i) => rules.read("minimumWageMonthly", ee.payroll.minimumWageMonthly, months[i].date)),
      ),
      exemption: inputs.useBasicExemption
        ? (rules.read("basicExemptionYearly", ee.payroll.basicExemptionYearly, firstDate) * indexes.length) / 12
        : 0,
      fundedPensionRate: inputs.fundedPensionPercent / 100,
      rates: {
        socialTax: socialTaxRate,
        incomeTax: rules.read("incomeTaxRate", ee.payroll.incomeTaxRate, firstDate),
        socialTaxDivisor: rules.read("fieSocialTaxDivisor", ee.soleProprietor.incomeTaxSocialTaxDivisor, firstDate),
        maxBaseMinimumWages: rules.read(
          "fieSocialTaxMaxBase",
          ee.soleProprietor.socialTaxMaxBaseMinimumWages,
          firstDate,
        ),
      },
    });
    result.push({ ...taxes, calendarYear, months: indexes.length, profit });

    // Booked evenly over the year's months.
    for (const i of indexes) incomeTaxes[i] += taxes.total / indexes.length;

    // Paid: minimum social tax each quarter (in the quarter's last month).
    let socialTaxAdvances = 0;
    indexes.forEach((i, k) => {
      const advance = round2(monthlyBases[k] * socialTaxRate);
      socialTaxAdvances += advance;
      const quarterEnd = schedule.socialTaxAdvanceMonths.value.find((m) => m >= months[i].calMonth)!;
      const payIndex = i + (quarterEnd - months[i].calMonth);
      if (payIndex < N) cashIncomeTaxes[payIndex] += advance;
    });

    // Paid: income tax advances from the second year, based on last year's tax.
    let incomeTaxAdvances = 0;
    if (previousIncomeTax !== null) {
      const { sharePerPayment, months: advanceMonths, skipIfNotAbove } = schedule.incomeTaxAdvance.value;
      const perPayment = round2(previousIncomeTax * sharePerPayment);
      if (perPayment > skipIfNotAbove) {
        for (const calMonth of advanceMonths) {
          incomeTaxAdvances += perPayment;
          const payIndex = indexOf(calendarYear, calMonth);
          if (payIndex >= 0) cashIncomeTaxes[payIndex] += perPayment;
        }
      }
    }

    // Paid: the rest in October of the next year (negative = refund).
    const settlement =
      taxes.socialTax - socialTaxAdvances + taxes.incomeTax - incomeTaxAdvances + taxes.fundedPension;
    const settlementIndex = indexOf(calendarYear + 1, schedule.settlementMonth.value);
    if (settlementIndex >= 0) cashIncomeTaxes[settlementIndex] += settlement;

    previousIncomeTax = taxes.incomeTax;
  }
  return result;
}
