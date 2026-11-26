"use client";

import { useFormatter, useTranslations } from "next-intl";
import { estonia, type CompanyType } from "@/config/countries/ee";
import type { ExplainTopic, TopicId } from "@/lib/finance/explain";
import type { ProjectionResult, Warning } from "@/lib/finance/projection";
import { Explanations, HowLink } from "./Explanations";

type Row = { label: string; values: string[]; strong?: boolean; alert?: boolean[]; how?: TopicId };

function Table({
  caption,
  columns,
  rows,
  howTopics,
}: {
  caption: string;
  columns: string[];
  rows: Row[];
  /** Topics that have an explanation; rows linked to them get a "How?" link. */
  howTopics: Set<TopicId>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full min-w-max text-sm">
        <caption className="px-3 pt-3 text-left text-base font-semibold text-slate-900">{caption}</caption>
        <thead>
          <tr className="border-b border-slate-200 text-slate-600">
            <th className="px-3 py-2 text-left font-medium" />
            {columns.map((column) => (
              <th key={column} scope="col" className="px-3 py-2 text-right font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className={`border-b border-slate-100 ${row.strong ? "font-semibold" : ""}`}>
              <th scope="row" className="px-3 py-1.5 text-left font-normal text-slate-800">
                {row.label}
                {row.how && howTopics.has(row.how) && <HowLink topic={row.how} />}
              </th>
              {row.values.map((value, index) => (
                <td key={index} className={`px-3 py-1.5 text-right tabular-nums ${row.alert?.[index] ? "text-red-700" : ""}`}>
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Props = { result: ProjectionResult; companyType: CompanyType; explanations: ExplainTopic[] };

export function FinanceResults({ result, companyType, explanations }: Props) {
  const t = useTranslations("finance");
  const format = useFormatter();
  const isFie = companyType === "FIE";
  const minimums = estonia.bankBenchmarks;

  // Amounts under 50 cents show as 0 € (avoids "−0 €" from rounding).
  const eur = (value: number) =>
    format.number(Math.abs(value) < 0.5 ? 0 : value, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const ratio = (value: number | null) =>
    value === null ? t("results.none") : format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const percent = (value: number | null) =>
    value === null ? t("results.none") : format.number(value, { style: "percent", maximumFractionDigits: 0 });
  const monthName = (ym: string) =>
    format.dateTime(new Date(`${ym}-01T12:00:00Z`), { month: "short", year: "numeric" });

  const years = result.years;
  const yearColumns = years.map((y) => t("results.year", { year: y.year }));
  const perYear = (pick: (y: (typeof years)[number]) => number) => years.map((y) => eur(pick(y)));

  function warningText(warning: Warning): string {
    switch (warning.code) {
      case "negativeCash":
        return t("warnings.negativeCash", { month: monthName(warning.month), amount: eur(warning.lowestCash) });
      case "lowDscr":
        return t("warnings.lowDscr", { year: warning.year, value: ratio(warning.value), minimum: ratio(warning.minimum) });
      case "lowCurrentRatio":
        return t("warnings.lowCurrentRatio", { year: warning.year, value: ratio(warning.value), minimum: ratio(warning.minimum) });
      case "lowEquityRatio":
        return t("warnings.lowEquityRatio", { year: warning.year, value: percent(warning.value), minimum: percent(warning.minimum) });
      case "highDebtToTurnover":
        return t("warnings.highDebtToTurnover", { year: warning.year, value: percent(warning.value), maximum: percent(warning.maximum) });
      case "vatRegistrationNeeded":
        return t("warnings.vatRegistrationNeeded", {
          year: warning.calendarYear,
          turnover: eur(warning.turnover),
          threshold: eur(warning.threshold),
        });
      case "dividendsAboveProfit":
        return t("warnings.dividendsAboveProfit", { year: warning.year });
    }
  }

  const knownAssumptions = ["socialTaxMonthlyMinBase", "minimumWageMonthly", "unemploymentInsurance"] as const;
  const assumptionText = (rule: string, year: number) =>
    (knownAssumptions as readonly string[]).includes(rule)
      ? t(`assumptions.${rule as (typeof knownAssumptions)[number]}`, { year })
      : t("assumptions.other", { year });

  const year1 = result.months.slice(0, 12);
  const howTopics = new Set(explanations.map((topic) => topic.id));

  return (
    <div className="space-y-6" id="results">
      <h2 className="text-xl font-bold text-slate-900">{t("results.title")}</h2>

      <section className="space-y-2">
        <h3 className="font-semibold text-slate-900">{t("warnings.title")}</h3>
        {result.warnings.length === 0 ? (
          <p className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900">{t("warnings.ok")}</p>
        ) : (
          <ul className="space-y-2">
            {result.warnings.map((warning, index) => (
              <li key={index} className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
                {warningText(warning)}
              </li>
            ))}
          </ul>
        )}
        {result.assumptions.length > 0 && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p className="font-medium">{t("assumptions.title")}</p>
            <p>{t("assumptions.intro")}</p>
            <ul className="list-disc pl-5">
              {result.assumptions.map((a) => (
                <li key={`${a.rule}-${a.year}`}>{assumptionText(a.rule, a.year)}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <Table
        howTopics={howTopics}
        caption={t("results.keyFigures")}
        columns={yearColumns}
        rows={[
          {
            label: t("results.dscr"),
            how: "dscr",
            values: years.map((y) => ratio(y.ratios.dscr)),
            alert: years.map((y) => y.ratios.dscr !== null && y.ratios.dscr < minimums.minDscr.value),
            strong: true,
          },
          { label: t("results.closingCash"), values: perYear((y) => y.closingCash), alert: years.map((y) => y.closingCash < 0) },
          { label: t("results.lowestCash"), values: perYear((y) => y.lowestCash), alert: years.map((y) => y.lowestCash < 0) },
          { label: t("results.breakEven"), how: "breakEven", values: years.map((y) => (y.ratios.breakEvenRevenue === null ? t("results.none") : eur(y.ratios.breakEvenRevenue))) },
          {
            label: t("results.equityRatio"),
            how: "equityRatio",
            values: years.map((y) => percent(y.ratios.equityRatio)),
            alert: years.map((y) => y.ratios.equityRatio !== null && y.ratios.equityRatio < minimums.minEquityRatio.value),
          },
          {
            label: t("results.currentRatio"),
            how: "currentRatio",
            values: years.map((y) => ratio(y.ratios.currentRatio)),
            alert: years.map((y) => y.ratios.currentRatio !== null && y.ratios.currentRatio < minimums.minCurrentRatio.value),
          },
        ]}
      />
      <p className="text-sm text-slate-600">{t("results.dscrHint", { minimum: ratio(minimums.minDscr.value) })}</p>

      <Table
        howTopics={howTopics}
        caption={t("results.pnl")}
        columns={yearColumns}
        rows={[
          { label: t("results.revenue"), values: perYear((y) => y.revenue), strong: true },
          { label: t("results.directCosts"), values: perYear((y) => -y.directCosts) },
          { label: t("results.grossProfit"), values: perYear((y) => y.grossProfit) },
          { label: t("results.operatingCosts"), values: perYear((y) => -y.operatingCosts) },
          { label: t("results.wages"), how: "payroll", values: perYear((y) => -y.wages) },
          { label: t("results.employerTaxes"), how: "payroll", values: perYear((y) => -y.employerTaxes) },
          { label: t("results.ebitda"), values: perYear((y) => y.ebitda), strong: true },
          { label: t("results.depreciation"), how: "depreciation", values: perYear((y) => -y.depreciation) },
          { label: t("results.interest"), how: "loan", values: perYear((y) => -(y.interest + y.loanFees)) },
          { label: isFie ? t("results.incomeTaxesFie") : t("results.incomeTaxes"), how: isFie ? "fieTaxes" : "dividendTax", values: perYear((y) => -y.incomeTaxes) },
          { label: t("results.netProfit"), values: perYear((y) => y.netProfit), strong: true, alert: years.map((y) => y.netProfit < 0) },
          { label: isFie ? t("results.toOwnerFie") : t("results.toOwner"), values: perYear((y) => y.toOwner) },
        ]}
      />

      <Table
        howTopics={howTopics}
        caption={t("results.balance")}
        columns={yearColumns}
        rows={[
          { label: t("results.cash"), values: perYear((y) => y.balance.cash), alert: years.map((y) => y.balance.cash < 0) },
          { label: t("results.receivables"), values: perYear((y) => y.balance.receivables) },
          { label: t("results.taxReceivable"), values: perYear((y) => y.balance.taxReceivable) },
          { label: t("results.fixedAssets"), values: perYear((y) => y.balance.fixedAssets) },
          { label: t("results.totalAssets"), values: perYear((y) => y.balance.totalAssets), strong: true },
          { label: t("results.taxPayable"), values: perYear((y) => y.balance.taxPayable) },
          { label: t("results.loanCurrent"), values: perYear((y) => y.balance.loanCurrent) },
          { label: t("results.loanLongTerm"), values: perYear((y) => y.balance.loanLongTerm) },
          { label: t("results.equity"), values: perYear((y) => y.balance.equity), strong: true, alert: years.map((y) => y.balance.equity < 0) },
        ]}
      />

      <Table
        howTopics={howTopics}
        caption={t("results.cashflow")}
        columns={year1.map((m) => monthName(m.month))}
        rows={[
          { label: t("results.fromSales"), values: year1.map((m) => eur(m.cashFromSales)) },
          { label: t("results.fromLoan"), values: year1.map((m) => eur(m.cashFromLoan)) },
          { label: t("results.fromOwner"), values: year1.map((m) => eur(m.cashFromOwner)) },
          { label: t("results.toSuppliers"), values: year1.map((m) => eur(-m.cashToSuppliers)) },
          { label: t("results.toStaff"), how: "payroll", values: year1.map((m) => eur(-m.cashToStaff)) },
          { label: t("results.payrollTaxes"), values: year1.map((m) => eur(-m.cashPayrollTaxes)) },
          { label: t("results.vat"), how: "vat", values: year1.map((m) => eur(-m.cashVat)) },
          { label: t("results.investmentsOut"), values: year1.map((m) => eur(-m.cashInvestments)) },
          { label: t("results.loanPayments"), how: "loan", values: year1.map((m) => eur(-(m.cashLoanPrincipal + m.cashInterestAndFees))) },
          { label: t("results.taxes"), values: year1.map((m) => eur(-m.cashIncomeTaxes)) },
          { label: isFie ? t("results.toOwnerFie") : t("results.toOwner"), values: year1.map((m) => eur(-m.cashToOwner)) },
          { label: t("results.net"), values: year1.map((m) => eur(m.netCashFlow)), strong: true },
          {
            label: t("results.closing"),
            values: year1.map((m) => eur(m.closingCash)),
            strong: true,
            alert: year1.map((m) => m.closingCash < 0),
          },
        ]}
      />

      {isFie && result.fieTaxYears.length > 0 && (
        <Table
          howTopics={howTopics}
          caption={t("results.fieTaxes")}
          columns={result.fieTaxYears.map((y) => `${y.calendarYear} (${y.months})`)}
          rows={[
            { label: t("results.profit"), values: result.fieTaxYears.map((y) => eur(y.profit)) },
            { label: t("results.socialTax"), values: result.fieTaxYears.map((y) => eur(y.socialTax)) },
            { label: t("results.pension"), values: result.fieTaxYears.map((y) => eur(y.fundedPension)) },
            { label: t("results.incomeTax"), values: result.fieTaxYears.map((y) => eur(y.incomeTax)) },
            { label: t("results.total"), how: "fieTaxes", values: result.fieTaxYears.map((y) => eur(y.total)), strong: true },
          ]}
        />
      )}

      {result.loanSchedule.length > 0 && (
        <details className="rounded-lg border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer font-semibold text-slate-900">{t("results.loanSchedule")}</summary>
          <div className="mt-3 max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-600">
                  <th className="px-2 py-1 text-left font-medium">{t("results.paymentNo")}</th>
                  <th className="px-2 py-1 text-left font-medium">{t("results.month")}</th>
                  <th className="px-2 py-1 text-right font-medium">{t("results.payment")}</th>
                  <th className="px-2 py-1 text-right font-medium">{t("results.principal")}</th>
                  <th className="px-2 py-1 text-right font-medium">{t("results.interestCol")}</th>
                  <th className="px-2 py-1 text-right font-medium">{t("results.balanceAfter")}</th>
                </tr>
              </thead>
              <tbody>
                {result.loanSchedule.map((p) => (
                  <tr key={p.number} className="border-t border-slate-100 tabular-nums">
                    <td className="px-2 py-1">{p.number}</td>
                    <td className="px-2 py-1">{monthName(p.month)}</td>
                    <td className="px-2 py-1 text-right">{format.number(p.payment, { style: "currency", currency: "EUR" })}</td>
                    <td className="px-2 py-1 text-right">{format.number(p.principal, { style: "currency", currency: "EUR" })}</td>
                    <td className="px-2 py-1 text-right">{format.number(p.interest, { style: "currency", currency: "EUR" })}</td>
                    <td className="px-2 py-1 text-right">{format.number(p.balanceAfter, { style: "currency", currency: "EUR" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <Explanations topics={explanations} />

      <section className="space-y-1 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
        <h3 className="font-semibold text-slate-900">{t("results.how")}</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t("results.how1", { date: format.dateTime(new Date(`${estonia.reviewed}T12:00:00Z`), { dateStyle: "long" }) })}</li>
          <li>{t("results.how2")}</li>
          <li>{isFie ? t("results.how4") : t("results.how3")}</li>
          <li>{t("results.how5")}</li>
        </ul>
      </section>
    </div>
  );
}
