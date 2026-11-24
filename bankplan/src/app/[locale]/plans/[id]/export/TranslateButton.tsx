"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Locale } from "@/i18n/routing";
import { translateSections } from "./actions";

type Props = { planId: string; lang: Locale; aiConfigured: boolean };

export function TranslateButton({ planId, lang, aiConfigured }: Props) {
  const t = useTranslations();
  const router = useRouter();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [working, startWorking] = useTransition();

  function translate() {
    setMessage(null);
    startWorking(async () => {
      const result = await translateSections({ planId, lang });
      const texts = {
        ok: "export.translated",
        notConfigured: "wizard.aiNotConfigured",
        refused: "wizard.aiRefused",
        invalid: "export.translateError",
        error: "export.translateError",
      } as const;
      setMessage({ kind: result.status === "ok" ? "ok" : "error", text: t(texts[result.status]) });
      // Show the new state of the plan (some sections may be translated even after an error).
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={translate}
        disabled={working || !aiConfigured}
        className="rounded-md bg-violet-700 px-4 py-2 font-medium text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {working ? t("export.translating") : t("export.translateButton")}
      </button>
      {!aiConfigured && <p className="text-sm text-amber-800">{t("wizard.aiNotConfigured")}</p>}
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-red-700" : "text-green-800"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
