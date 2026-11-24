import { notFound } from "next/navigation";
import { companyTypes, type CompanyType } from "@/config/countries/ee";
import { requireUser } from "@/lib/auth";
import { defaultFinanceInputs, financeInputsSchema } from "@/lib/finance/inputs";
import { getMyPlanFinance } from "@/lib/plans";
import { FinanceEditor } from "./FinanceEditor";

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function FinancePage({ params }: Props) {
  const { locale, id } = await params;
  await requireUser(locale);
  const plan = await getMyPlanFinance(id);
  if (!plan) notFound();

  const saved = financeInputsSchema.safeParse(plan.finance);
  const companyType: CompanyType = (companyTypes as readonly string[]).includes(plan.company_type)
    ? (plan.company_type as CompanyType)
    : "OU";

  return (
    <FinanceEditor
      planId={plan.id}
      planTitle={plan.title}
      companyType={companyType}
      initialInputs={saved.success ? saved.data : defaultFinanceInputs()}
    />
  );
}
