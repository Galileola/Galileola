"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { sendLoginLink, verifyLoginCode, type CodeState, type LoginState } from "./actions";

export function LoginForm() {
  const t = useTranslations("login");
  const locale = useLocale();
  const [state, formAction] = useActionState<LoginState, FormData>(sendLoginLink, { status: "idle" });
  // The "sent" result the person closed to type another email (a new result shows again).
  const [closed, setClosed] = useState<LoginState | null>(null);

  if (state.status === "sent" && state !== closed) {
    return (
      <div className="space-y-4">
        <div role="status" className="rounded-md border border-green-300 bg-green-50 p-4 text-green-900">
          <h2 className="font-semibold">{t("sentTitle")}</h2>
          <p className="mt-1">{t("sentText")}</p>
        </div>
        <CodeForm email={state.email} locale={locale} />
        <button type="button" onClick={() => setClosed(state)} className="text-sm text-blue-700 underline">
          {t("otherEmail")}
        </button>
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

/** Typing the code from the email logs in on this device, wherever the email was read. */
function CodeForm({ email, locale }: { email: string; locale: string }) {
  const t = useTranslations("login");
  const [state, formAction] = useActionState<CodeState, FormData>(verifyLoginCode, { status: "idle" });

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="locale" value={locale} />
      <div className="space-y-1">
        <label htmlFor="code" className="block font-medium text-slate-800">
          {t("codeLabel")}
        </label>
        <input
          id="code"
          name="code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={14}
          className="w-40 rounded-md border border-slate-300 bg-white px-3 py-2 text-lg tracking-widest"
        />
      </div>
      {(state.status === "wrongCode" || state.status === "invalid") && (
        <p role="alert" className="text-red-700">{t("errorCode")}</p>
      )}
      {state.status === "tooMany" && <p role="alert" className="text-red-700">{t("errorTooMany")}</p>}
      {state.status === "error" && <p role="alert" className="text-red-700">{t("errorGeneric")}</p>}
      <SubmitButton label={t("codeSubmit")} pendingLabel={t("codeChecking")} />
    </form>
  );
}
