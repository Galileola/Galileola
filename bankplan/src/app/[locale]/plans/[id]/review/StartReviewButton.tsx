"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Locale } from "@/i18n/routing";
import { startReview } from "./actions";

type Props = { planId: string; locale: Locale; hasReview: boolean; aiConfigured: boolean };

export function StartReviewButton({ planId, locale, hasReview, aiConfigured }: Props) {
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [working, startWorking] = useTransition();

  function start() {
    if (hasReview && !window.confirm(t("review.restartConfirm"))) return;
    setError(null);
    startWorking(async () => {
      const result = await startReview({ planId, locale });
      if (result.status === "ok") {
        router.refresh();
        return;
      }
      const texts = {
        needPlan: "review.needPlan",
        notConfigured: "wizard.aiNotConfigured",
        refused: "wizard.aiRefused",
        limit: "wizard.aiLimit",
        invalid: "review.error",
        error: "review.error",
      } as const;
      setError(t(texts[result.status]));
    });
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={start}
        disabled={working || !aiConfigured}
        className={
          hasReview
            ? "rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            : "rounded-md bg-violet-700 px-4 py-2 font-medium text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {working ? t("review.starting") : hasReview ? t("review.restart") : t("review.start")}
      </button>
      {!aiConfigured && <p className="text-sm text-amber-800">{t("wizard.aiNotConfigured")}</p>}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
