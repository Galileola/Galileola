import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";
import { listMyPlans } from "@/lib/plans";
import { NewPlanForm } from "./NewPlanForm";

type Props = { params: Promise<{ locale: string }> };

export default async function PlansPage({ params }: Props) {
  const { locale } = await params;
  await requireUser(locale);
  const t = await getTranslations("plans");
  const format = await getFormatter();
  const plans = await listMyPlans();

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>

      {plans.length === 0 ? (
        <p className="text-slate-700">{t("empty")}</p>
      ) : (
        <ul className="space-y-3">
          {plans.map((plan) => (
            <li key={plan.id}>
              <Link
                href={`/plans/${plan.id}`}
                className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-blue-400"
              >
                <span className="font-semibold text-slate-900">{plan.title}</span>
                <span className="mt-1 block text-sm text-slate-600">
                  {plan.company_type === "FIE" ? t("companyTypeFIE") : t("companyTypeOU")} ·{" "}
                  {t("updated", { date: format.dateTime(new Date(plan.updated_at), { dateStyle: "medium" }) })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <NewPlanForm />
    </div>
  );
}
