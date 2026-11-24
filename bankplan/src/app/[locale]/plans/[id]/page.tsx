import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";
import { hasAnyAnswer, readPlanAnswers } from "@/lib/plan/answers";
import { getMyPlanFull } from "@/lib/plans";
import { bankLoanSections } from "@/plan-types/bank-loan/sections";

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function PlanOverviewPage({ params }: Props) {
  const { locale, id } = await params;
  await requireUser(locale);
  const plan = await getMyPlanFull(id);
  if (!plan) notFound();
  const answers = readPlanAnswers(plan.answers);

  const t = await getTranslations();
  const later = [t("plan.bankReview")];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{plan.title}</h1>
        <p className="mt-1 text-slate-600">
          {plan.company_type === "FIE" ? t("plans.companyTypeFIE") : t("plans.companyTypeOU")}
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">{t("plan.sectionsTitle")}</h2>
        <ol className="space-y-2">
          {bankLoanSections.map((section, index) => (
            <li key={section}>
              <Link
                href={`/plans/${plan.id}/step/${section}`}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 hover:border-blue-400"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
                  {index + 1}
                </span>
                <span className="flex-1 text-slate-900">{t(`sections.${section}.title`)}</span>
                {answers[section]?.text.trim() ? (
                  <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-900">✓ {t("wizard.statusText")}</span>
                ) : hasAnyAnswer(answers[section]) ? (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{t("wizard.statusStarted")}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">{t("plan.finance")}</h2>
        <Link
          href={`/plans/${plan.id}/finance`}
          className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-blue-400"
        >
          <span className="font-medium text-blue-800">{t("finance.title")} →</span>
        </Link>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">{t("export.title")}</h2>
        <Link
          href={`/plans/${plan.id}/export`}
          className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-blue-400"
        >
          <span className="font-medium text-blue-800">{t("plan.export")} →</span>
        </Link>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">{t("plan.laterTitle")}</h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {later.map((label) => (
            <li key={label} className="rounded-lg border border-dashed border-slate-300 p-3 text-slate-500">
              {label}
              <span className="mt-1 block text-xs uppercase tracking-wide">{t("plan.comingSoon")}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
