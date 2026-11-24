import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";
import { getMyPlan } from "@/lib/plans";
import { bankLoanSections, isBankLoanSection } from "@/plan-types/bank-loan/sections";

type Props = { params: Promise<{ locale: string; id: string; step: string }> };

export default async function WizardStepPage({ params }: Props) {
  const { locale, id, step } = await params;
  await requireUser(locale);
  if (!isBankLoanSection(step)) notFound();
  const plan = await getMyPlan(id);
  if (!plan) notFound();

  const t = await getTranslations();
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
      </div>

      <p className="rounded-lg border border-dashed border-slate-300 p-6 text-slate-500">{t("plan.placeholder")}</p>

      <nav className="flex justify-between">
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
            className="rounded-md bg-blue-700 px-4 py-2 text-white hover:bg-blue-800"
          >
            {t("plan.next")} →
          </Link>
        ) : (
          <Link href={`/plans/${plan.id}`} className="rounded-md bg-blue-700 px-4 py-2 text-white hover:bg-blue-800">
            {t("plan.toOverview")}
          </Link>
        )}
      </nav>
    </div>
  );
}
