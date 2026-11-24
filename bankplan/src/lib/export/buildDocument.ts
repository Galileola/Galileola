import { estonia, type CompanyType } from "@/config/countries/ee";
import type { Rule, Source } from "@/config/types";
import type { Locale } from "@/i18n/routing";
import { financeInputsSchema } from "@/lib/finance/inputs";
import { calculateProjection, type ProjectionResult } from "@/lib/finance/projection";
import { valueAt } from "@/lib/finance/rules";
import { textHash, type PlanAnswers, type SectionAnswer } from "@/lib/plan/answers";
import { bankLoanSections } from "@/plan-types/bank-loan/sections";
import { textToBlocks, type Block, type ExportDocument, type TableRow } from "./model";

/** Translation function for the document's language (next-intl's `t`, loosely typed). */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

export type PlanForExport = {
  title: string;
  companyType: CompanyType;
  answers: PlanAnswers;
  finance: unknown;
};

const LOCALE_TAGS: Record<Locale, string> = { et: "et-EE", ru: "ru-RU", en: "en-GB" };

/** The section's text in the document language, or the original text with a note. */
export function sectionTextFor(answer: SectionAnswer | undefined, locale: Locale): { text: string; untranslatedFrom?: Locale } {
  const text = answer?.text.trim() ?? "";
  if (!answer || !text) return { text: "" };
  const from = answer.textLocale ?? locale;
  if (from === locale) return { text };
  const translation = answer.translations?.[locale];
  if (translation && translation.sourceHash === textHash(answer.text)) return { text: translation.text };
  return { text, untranslatedFrom: from };
}

/** Sections whose text is in another language and has no up-to-date translation. */
export function sectionsNeedingTranslation(answers: PlanAnswers, locale: Locale) {
  return bankLoanSections.filter((section) => sectionTextFor(answers[section], locale).untranslatedFrom);
}

/** The saved calculator inputs, or null when no numbers are filled in yet. */
export function filledFinanceInputs(raw: unknown) {
  const parsed = financeInputsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const i = parsed.data;
  const filled = i.revenue.length > 0 || i.loan.amount > 0 || i.ownContribution > 0 || i.investments.length > 0;
  return filled ? i : null;
}

export function buildPlanDocument(plan: PlanForExport, locale: Locale, t: Translate, now: Date): ExportDocument {
  const tag = LOCALE_TAGS[locale];
  const money = new Intl.NumberFormat(tag, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const cents = new Intl.NumberFormat(tag, { style: "currency", currency: "EUR" });
  const eur = (value: number) => money.format(Math.abs(value) < 0.5 ? 0 : value);
  const ratio = (value: number | null) =>
    value === null ? t("finance.results.none") : new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const percent = (value: number | null, digits = 0) =>
    value === null ? t("finance.results.none") : new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: digits }).format(value);
  const month = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    return new Intl.DateTimeFormat(tag, { month: "short", year: "numeric", timeZone: "UTC" }).format(Date.UTC(y, m - 1, 1));
  };
  const longDate = (date: Date) => new Intl.DateTimeFormat(tag, { dateStyle: "long", timeZone: "Europe/Tallinn" }).format(date);

  const blocks: Block[] = [];
  const sectionTitles = bankLoanSections.map((section, i) => `${i + 1}. ${t(`sections.${section}.title`)}`);
  const numbersHeading = `${bankLoanSections.length + 1}. ${t("document.numbersTitle")}`;
  const inputs = filledFinanceInputs(plan.finance);
  const hasLoan = Boolean(inputs && inputs.loan.amount > 0);

  // Contents
  blocks.push({ type: "heading", level: 1, text: t("document.contents") });
  blocks.push({
    type: "bullets",
    items: [...sectionTitles, numbersHeading, t("document.basisTitle"), ...(hasLoan ? [t("document.scheduleTitle")] : [])],
  });
  blocks.push({ type: "pageBreak" });

  // 1–11: the written sections
  bankLoanSections.forEach((section, i) => {
    blocks.push({ type: "heading", level: 1, text: sectionTitles[i] });
    const { text, untranslatedFrom } = sectionTextFor(plan.answers[section], locale);
    if (!text) {
      blocks.push({ type: "note", text: t("document.notWritten") });
      return;
    }
    if (untranslatedFrom) {
      blocks.push({ type: "note", text: t("document.notTranslated", { language: t(`document.languages.${untranslatedFrom}`) }) });
    }
    blocks.push(...textToBlocks(text));
  });

  // 12: numbers
  blocks.push({ type: "pageBreak" });
  blocks.push({ type: "heading", level: 1, text: numbersHeading });
  let result: ProjectionResult | null = null;
  if (!inputs) {
    blocks.push({ type: "note", text: t("document.numbersMissing") });
  } else {
    result = calculateProjection(inputs, plan.companyType);
    const isFie = plan.companyType === "FIE";
    const years = result.years;
    const columns = years.map((y) => t("finance.results.year", { year: y.year }));
    const row = (label: string, pick: (y: (typeof years)[number]) => number, bold = false): TableRow => ({
      label,
      values: years.map((y) => eur(pick(y))),
      bold,
    });
    const r = (key: string) => t(`finance.results.${key}`);

    blocks.push({
      type: "paragraph",
      text: t("document.forecastPeriod", { from: month(result.months[0].month), to: month(result.months[result.months.length - 1].month) }),
    });
    blocks.push({
      type: "table",
      title: r("keyFigures"),
      columns,
      rows: [
        { label: r("dscr"), values: years.map((y) => ratio(y.ratios.dscr)), bold: true },
        row(r("closingCash"), (y) => y.closingCash),
        row(r("lowestCash"), (y) => y.lowestCash),
        { label: r("breakEven"), values: years.map((y) => (y.ratios.breakEvenRevenue === null ? r("none") : eur(y.ratios.breakEvenRevenue))) },
        { label: r("equityRatio"), values: years.map((y) => percent(y.ratios.equityRatio)) },
        { label: r("currentRatio"), values: years.map((y) => ratio(y.ratios.currentRatio)) },
      ],
    });
    blocks.push({
      type: "table",
      title: r("pnl"),
      columns,
      rows: [
        row(r("revenue"), (y) => y.revenue, true),
        row(r("directCosts"), (y) => -y.directCosts),
        row(r("grossProfit"), (y) => y.grossProfit),
        row(r("operatingCosts"), (y) => -y.operatingCosts),
        row(r("wages"), (y) => -y.wages),
        row(r("employerTaxes"), (y) => -y.employerTaxes),
        row(r("ebitda"), (y) => y.ebitda, true),
        row(r("depreciation"), (y) => -y.depreciation),
        row(r("interest"), (y) => -(y.interest + y.loanFees)),
        row(isFie ? r("incomeTaxesFie") : r("incomeTaxes"), (y) => -y.incomeTaxes),
        row(r("netProfit"), (y) => y.netProfit, true),
        row(isFie ? r("toOwnerFie") : r("toOwner"), (y) => y.toOwner),
      ],
    });
    blocks.push({
      type: "table",
      title: r("balance"),
      columns,
      rows: [
        row(r("cash"), (y) => y.balance.cash),
        row(r("receivables"), (y) => y.balance.receivables),
        row(r("taxReceivable"), (y) => y.balance.taxReceivable),
        row(r("fixedAssets"), (y) => y.balance.fixedAssets),
        row(r("totalAssets"), (y) => y.balance.totalAssets, true),
        row(r("taxPayable"), (y) => y.balance.taxPayable),
        row(r("loanCurrent"), (y) => y.balance.loanCurrent),
        row(r("loanLongTerm"), (y) => y.balance.loanLongTerm),
        row(r("equity"), (y) => y.balance.equity, true),
      ],
    });

    const year1 = result.months.slice(0, 12);
    const monthly = (label: string, pick: (m: (typeof year1)[number]) => number, bold = false): TableRow => ({
      label,
      values: year1.map((m) => eur(pick(m))),
      bold,
    });
    blocks.push({
      type: "table",
      title: r("cashflow"),
      wide: true,
      columns: year1.map((m) => month(m.month)),
      rows: [
        monthly(r("fromSales"), (m) => m.cashFromSales),
        monthly(r("fromLoan"), (m) => m.cashFromLoan),
        monthly(r("fromOwner"), (m) => m.cashFromOwner),
        monthly(r("toSuppliers"), (m) => -m.cashToSuppliers),
        monthly(r("toStaff"), (m) => -m.cashToStaff),
        monthly(r("payrollTaxes"), (m) => -m.cashPayrollTaxes),
        monthly(r("vat"), (m) => -m.cashVat),
        monthly(r("investmentsOut"), (m) => -m.cashInvestments),
        monthly(r("loanPayments"), (m) => -(m.cashLoanPrincipal + m.cashInterestAndFees)),
        monthly(r("taxes"), (m) => -m.cashIncomeTaxes),
        monthly(isFie ? r("toOwnerFie") : r("toOwner"), (m) => -m.cashToOwner),
        monthly(r("net"), (m) => m.netCashFlow, true),
        monthly(r("closing"), (m) => m.closingCash, true),
      ],
    });

    if (isFie && result.fieTaxYears.length > 0) {
      blocks.push({
        type: "table",
        title: r("fieTaxes"),
        columns: result.fieTaxYears.map((y) => `${y.calendarYear} (${y.months})`),
        rows: [
          { label: r("profit"), values: result.fieTaxYears.map((y) => eur(y.profit)) },
          { label: r("socialTax"), values: result.fieTaxYears.map((y) => eur(y.socialTax)) },
          { label: r("pension"), values: result.fieTaxYears.map((y) => eur(y.fundedPension)) },
          { label: r("incomeTax"), values: result.fieTaxYears.map((y) => eur(y.incomeTax)) },
          { label: r("total"), values: result.fieTaxYears.map((y) => eur(y.total)), bold: true },
        ],
      });
    }

    if (inputs.loan.amount > 0) {
      const loan = inputs.loan;
      blocks.push({ type: "heading", level: 2, text: t("document.loanTitle") });
      blocks.push({
        type: "paragraph",
        text: t("document.loanTerms", {
          amount: eur(loan.amount),
          rate: new Intl.NumberFormat(tag, { maximumFractionDigits: 2 }).format(loan.annualInterestPercent),
          months: loan.termMonths,
          type: loan.type === "annuity" ? t("document.loanAnnuity") : t("document.loanEqualPrincipal"),
        }),
      });
      if (loan.graceMonths > 0) blocks.push({ type: "paragraph", text: t("document.loanGrace", { months: loan.graceMonths }) });
      blocks.push({
        type: "table",
        title: t("document.loanByYear"),
        columns,
        rows: [
          row(t("document.principalPaid"), (y) => y.loanPrincipalPaid),
          row(t("document.interestPaid"), (y) => y.interestPaid),
          row(t("document.loanLeft"), (y) => y.balance.loanCurrent + y.balance.loanLongTerm, true),
        ],
      });
    }
  }

  // Appendix A: calculation basis and sources
  blocks.push({ type: "pageBreak" });
  blocks.push({ type: "heading", level: 1, text: t("document.basisTitle") });
  blocks.push({ type: "paragraph", text: t("document.basisIntro") });
  const startDate = `${inputs?.startMonth ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`}-01`;
  const at = <T,>(rule: Rule<T>) => valueAt(rule, startDate).value;
  const source = (rule: { periods: { from: string; sources: Source[] }[] }) => {
    const period = [...rule.periods].reverse().find((p) => p.from <= startDate) ?? rule.periods[0];
    const s = period.sources.find((x) => x.ref) ?? period.sources[0];
    // Only the legal reference ("TuMS § 4 lg 1"), without the explanation after it.
    const ref = s.ref ? s.ref.split(/ — | \(/)[0] : s.url;
    return `${ref} (${t("document.checked", { date: longDate(new Date(`${s.checked}T12:00:00Z`)) })})`;
  };
  const p = estonia.payroll;
  const distributionRate = at(estonia.corporate.distributionTaxRate);
  const taxRow = (key: string, value: string, rule: Rule<unknown>) => ({
    label: t(`document.taxRows.${key}`),
    values: [value, source(rule)],
  });
  blocks.push({
    type: "table",
    labelHeader: t("document.rule"),
    columns: [t("document.value"), t("document.source")],
    columnWidths: [34, 14, 52],
    rows: [
      taxRow("incomeTax", percent(at(p.incomeTaxRate)), p.incomeTaxRate),
      taxRow("basicExemption", eur(at(p.basicExemptionMonthly)), p.basicExemptionYearly),
      taxRow("socialTax", percent(at(p.socialTaxRate)), p.socialTaxRate),
      taxRow("socialTaxBase", eur(at(p.socialTaxMonthlyMinBase)), p.socialTaxMonthlyMinBase),
      taxRow(
        "unemployment",
        `${percent(at(p.unemploymentInsuranceEmployee), 1)} / ${percent(at(p.unemploymentInsuranceEmployer), 1)}`,
        p.unemploymentInsuranceEmployee,
      ),
      taxRow("pension", percent(at(p.fundedPensionDefaultRate)), p.fundedPensionDefaultRate),
      taxRow("vat", percent(at(estonia.vat.standardRate)), estonia.vat.standardRate),
      taxRow("vatThreshold", eur(at(estonia.vat.registrationThreshold)), estonia.vat.registrationThreshold),
      taxRow(
        "dividendTax",
        `${Math.round(distributionRate * 100)}/${Math.round((1 - distributionRate) * 100)}`,
        estonia.corporate.distributionTaxRate,
      ),
    ],
  });
  blocks.push({
    type: "bullets",
    items: [
      t("finance.results.how2"),
      plan.companyType === "FIE" ? t("finance.results.how4") : t("finance.results.how3"),
      t("finance.results.how5"),
    ],
  });
  if (result && result.assumptions.length > 0) {
    const known = ["socialTaxMonthlyMinBase", "minimumWageMonthly", "unemploymentInsurance"];
    blocks.push({ type: "heading", level: 2, text: t("document.assumptionsTitle") });
    blocks.push({
      type: "bullets",
      items: result.assumptions.map((a) =>
        known.includes(a.rule) ? t(`finance.assumptions.${a.rule}`, { year: a.year }) : t("finance.assumptions.other", { year: a.year }),
      ),
    });
  }
  blocks.push({ type: "note", text: t("document.disclaimer") });

  // Appendix B: full loan schedule
  if (result && result.loanSchedule.length > 0) {
    blocks.push({ type: "pageBreak" });
    blocks.push({ type: "heading", level: 1, text: t("document.scheduleTitle") });
    blocks.push({
      type: "table",
      labelHeader: t("finance.results.paymentNo"),
      columns: [
        t("finance.results.month"),
        t("finance.results.payment"),
        t("finance.results.principal"),
        t("finance.results.interestCol"),
        t("finance.results.balanceAfter"),
      ],
      rows: result.loanSchedule.map((payment) => ({
        label: String(payment.number),
        values: [month(payment.month), cents.format(payment.payment), cents.format(payment.principal), cents.format(payment.interest), cents.format(payment.balanceAfter)],
      })),
    });
  }

  return {
    locale,
    title: plan.title,
    subtitle: t("document.subtitle"),
    meta: [
      `${t("document.businessForm")}: ${plan.companyType === "FIE" ? t("plans.companyTypeFIE") : t("plans.companyTypeOU")}`,
      t("document.preparedOn", { date: longDate(now) }),
    ],
    disclaimer: t("document.disclaimer"),
    pageLabel: t("document.pageOf", { page: "{page}", total: "{total}" }),
    blocks,
  };
}
