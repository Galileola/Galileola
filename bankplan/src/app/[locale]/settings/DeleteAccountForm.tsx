"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { deleteAccount, type DeleteAccountState } from "./actions";

export function DeleteAccountForm() {
  const t = useTranslations("settings");
  const locale = useLocale();
  const [confirmed, setConfirmed] = useState(false);
  const [state, formAction] = useActionState<DeleteAccountState, FormData>(deleteAccount, { status: "idle" });

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="locale" value={locale} />
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          name="confirm"
          value="yes"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-1"
        />
        <span>{t("deleteConfirm")}</span>
      </label>
      {state.status === "error" && <p role="alert" className="text-red-700">{t("deleteError")}</p>}
      <SubmitButton label={t("deleteButton")} pendingLabel={t("deleting")} variant="danger" disabled={!confirmed} />
    </form>
  );
}
