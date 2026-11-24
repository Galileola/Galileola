import type { CompanyType } from "@/config/countries/ee";
import { financeInputsSchema } from "./inputs";
import { calculateProjection } from "./projection";

const eur = (value: number) => `${Math.round(value).toLocaleString("en-US")} EUR`;
const twoDecimals = (value: number | null) => (value === null ? "no loan payments" : value.toFixed(2));

/**
 * The plan's key figures as short English lines, for the AI helper and (later)
 * the bank officer simulator. Returns an empty list if the numbers are not filled in.
 */
export function keyNumbers(rawFinance: unknown, companyType: CompanyType): string[] {
  const parsed = financeInputsSchema.safeParse(rawFinance);
  if (!parsed.success) return [];
  const inputs = parsed.data;
  const hasNumbers =
    inputs.revenue.length > 0 || inputs.loan.amount > 0 || inputs.ownContribution > 0 || inputs.investments.length > 0;
  if (!hasNumbers) return [];

  const result = calculateProjection(inputs, companyType);
  const years = result.years;
  const loan = inputs.loan;
  const lines = [`Forecast starts: ${inputs.startMonth} (3 years)`];

  if (loan.amount > 0) {
    lines.push(
      `Loan asked: ${eur(loan.amount)}, ${loan.annualInterestPercent}% a year, ${loan.termMonths} months, ` +
        `${loan.type === "annuity" ? "equal monthly payments" : "equal principal payments"}` +
        (loan.graceMonths > 0 ? `, first ${loan.graceMonths} months interest only` : ""),
    );
  } else {
    lines.push("Loan: not entered in the calculator");
  }
  lines.push(`Own money put in: ${eur(inputs.ownContribution)}`);
  if (inputs.investments.length > 0) {
    const items = inputs.investments.map((i) => `${i.name || "item"} ${eur(i.amount)}`).join("; ");
    lines.push(`Investments (without VAT): ${items}`);
  }
  lines.push(`Sales: ${years.map((y) => `year ${y.year} ${eur(y.revenue)}`).join(", ")}`);
  lines.push(`Net profit: ${years.map((y) => `year ${y.year} ${eur(y.netProfit)}`).join(", ")}`);
  lines.push(`Debt service coverage (DSCR, banks want at least 1.2): ${years.map((y) => `year ${y.year} ${twoDecimals(y.ratios.dscr)}`).join(", ")}`);
  lines.push(`Lowest cash balance in the forecast: ${eur(Math.min(...years.map((y) => y.lowestCash)))}`);
  return lines;
}
