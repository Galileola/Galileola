import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";
import { getMyPlan } from "@/lib/plans";
import { bankLoanSections } from "@/plan-types/bank-loan/sections";

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function PlanOverviewPage({ params }: Props) {
  const { locale, id } = await params;
  await requireUser(locale);
  const plan = await getMyPlan(id);
  if (!plan) notFound();

  const t = await getTranslations();
  const later = [t("plan.finance"), t("plan.export"), t("plan.bankReview")];

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
                <span className="text-slate-900">{t(`sections.${section}.title`)}</span>
              </Link>
            </li>
          ))}
        </ol>
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
