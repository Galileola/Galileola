import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { estonia } from "@/config/countries/ee";
import { Link } from "@/i18n/navigation";
import { isAiConfigured } from "@/lib/ai/claude";
import { requireUser } from "@/lib/auth";
import { readPlanAnswers } from "@/lib/plan/answers";
import { getMyPlanFull } from "@/lib/plans";
import { bankLoanSections, isBankLoanSection } from "@/plan-types/bank-loan/sections";
import { StepForm } from "./StepForm";

type Props = { params: Promise<{ locale: string; id: string; step: string }> };

export default async function WizardStepPage({ params }: Props) {
  const { locale, id, step } = await params;
  await requireUser(locale);
  if (!isBankLoanSection(step)) notFound();
  const plan = await getMyPlanFull(id);
  if (!plan) notFound();

  const t = await getTranslations();
  const format = await getFormatter();
  const saved = readPlanAnswers(plan.answers)[step];
  const index = bankLoanSections.indexOf(step);
  const previous = bankLoanSections[index - 1];
  const next = bankLoanSections[index + 1];
  const progress = Math.round(((index + 1) / bankLoanSections.length) * 100);

  return (
    <div className="space-y-6">
      <Link href={`/plans/${plan.id}`} className="text-sm text-blue-700 underline">
        {t("plan.toOverview")}
      </Link>

      <div className="space-y-2">
        <p className="text-sm text-slate-600">
          {t("plan.stepOf", { current: index + 1, total: bankLoanSections.length })}
        </p>
        <div className="h-2 w-full rounded-full bg-slate-200" aria-hidden="true">
          <div className="h-2 rounded-full bg-blue-700" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <h1 className="text-2xl font-bold text-slate-900">{t(`sections.${step}.title`)}</h1>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <h2 className="font-semibold text-blue-900">{t("plan.bankLooksFor")}</h2>
        <p className="mt-1 text-blue-900">{t(`sections.${step}.hint`)}</p>
        <details className="mt-2 text-sm text-blue-900">
          <summary className="cursor-pointer font-medium underline">{t("plan.whyAsk")}</summary>
          <p className="mt-1">{t(`sections.${step}.why`, bankFigures(format))}</p>
        </details>
      </div>

      {/* key: a fresh form for each section, so typed answers never leak between steps */}
      <StepForm
        key={step}
        planId={plan.id}
        section={step}
        initialAnswers={saved?.q ?? {}}
        initialText={saved?.text ?? ""}
        aiConfigured={isAiConfigured()}
      />

      <nav className="flex justify-between border-t border-slate-200 pt-4">
        {previous ? (
          <Link
            href={`/plans/${plan.id}/step/${previous}`}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-slate-800 hover:bg-slate-50"
          >
            ← {t("plan.back")}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/plans/${plan.id}/step/${next}`}
            className="rounded-md border border-blue-700 bg-white px-4 py-2 text-blue-800 hover:bg-blue-50"
          >
            {t("plan.next")} →
          </Link>
        ) : (
          <Link href={`/plans/${plan.id}`} className="rounded-md border border-blue-700 bg-white px-4 py-2 text-blue-800 hover:bg-blue-50">
            {t("plan.toOverview")}
          </Link>
        )}
      </nav>
    </div>
  );
}

/** Bank benchmarks quoted in the "Why does the bank ask this?" texts, from the checked config. */
function bankFigures(format: Awaited<ReturnType<typeof getFormatter>>) {
  const b = estonia.bankBenchmarks;
  const pct = (value: number) => format.number(value, { style: "percent", maximumFractionDigits: 0 });
  const coop = b.ownContributionExamples.value.find((l) => l.lender.startsWith("Coop"))?.share ?? 0;
  return {
    minDscr: format.number(b.minDscr.value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    coopShare: pct(1 - coop),
    eisMin: pct(b.ownContributionTarget.value.minimum),
    eisShare: pct(b.eisGuarantee.value.maxShareOfLoan),
  };
}
