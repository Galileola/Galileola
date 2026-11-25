"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { sendLoginLink, type LoginState } from "./actions";

export function LoginForm() {
  const t = useTranslations("login");
  const locale = useLocale();
  const [state, formAction] = useActionState<LoginState, FormData>(sendLoginLink, { status: "idle" });

  if (state.status === "sent") {
    return (
      <div role="status" className="rounded-md border border-green-300 bg-green-50 p-4 text-green-900">
        <h2 className="font-semibold">{t("sentTitle")}</h2>
        <p className="mt-1">{t("sentText")}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <div className="space-y-1">
        <label htmlFor="email" className="block font-medium text-slate-800">
          {t("emailLabel")}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"
        />
      </div>
      {state.status === "invalid" && <p role="alert" className="text-red-700">{t("errorInvalid")}</p>}
      {state.status === "error" && <p role="alert" className="text-red-700">{t("errorGeneric")}</p>}
      {state.status === "tooMany" && <p role="alert" className="text-red-700">{t("errorTooMany")}</p>}
      {state.status === "notAllowed" && <p role="alert" className="text-red-700">{t("errorNotAllowed")}</p>}
      <SubmitButton label={t("submit")} pendingLabel={t("sending")} />
    </form>
  );
}
