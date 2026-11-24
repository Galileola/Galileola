"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { createPlan, type CreatePlanState } from "./actions";

export function NewPlanForm() {
  const t = useTranslations("plans");
  const locale = useLocale();
  const [state, formAction] = useActionState<CreatePlanState, FormData>(createPlan, { status: "idle" });

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold text-slate-900">{t("newTitle")}</h2>
      <input type="hidden" name="locale" value={locale} />

      <div className="space-y-1">
        <label htmlFor="title" className="block font-medium text-slate-800">
          {t("nameLabel")}
        </label>
        <input
          id="title"
          name="title"
          required
          maxLength={200}
          placeholder={t("namePlaceholder")}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="font-medium text-slate-800">{t("companyTypeLabel")}</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="companyType" value="OU" defaultChecked />
          {t("companyTypeOU")}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="companyType" value="FIE" />
          {t("companyTypeFIE")}
        </label>
      </fieldset>

      {state.status === "invalid" && <p role="alert" className="text-red-700">{t("errorInvalid")}</p>}
      {state.status === "error" && <p role="alert" className="text-red-700">{t("errorGeneric")}</p>}
      <SubmitButton label={t("create")} pendingLabel={t("creating")} />
    </form>
  );
}
