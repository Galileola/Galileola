"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Locale } from "@/i18n/routing";
import type { Rating } from "@/lib/review/readiness";
import { checkAnswers } from "./actions";

type Question = {
  question: string;
  why: string;
  answer: string;
  /** Null when not answered, not checked yet, or changed since the check. */
  rating: { value: Rating; feedback: string } | null;
};
type Props = { planId: string; reviewCreatedAt: string; aiConfigured: boolean; maxAnswerLength: number; questions: Question[] };

const RATING_STYLE: Record<Rating, string> = {
  strong: "bg-green-100 text-green-900",
  ok: "bg-amber-100 text-amber-900",
  weak: "bg-red-100 text-red-900",
};

export function InterviewForm({ planId, reviewCreatedAt, aiConfigured, maxAnswerLength, questions }: Props) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [answers, setAnswers] = useState(questions.map((q) => q.answer));
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [working, startWorking] = useTransition();

  function check() {
    setMessage(null);
    startWorking(async () => {
      const result = await checkAnswers({ planId, locale, reviewCreatedAt, answers });
      const texts = {
        ok: "review.checked",
        notConfigured: "wizard.aiNotConfigured",
        refused: "review.savedNotChecked",
        limit: "wizard.aiLimit",
        error: "review.savedNotChecked",
        invalid: "review.error",
        needPlan: "review.error",
      } as const;
      setMessage({ kind: result.status === "ok" ? "ok" : "error", text: t(texts[result.status]) });
      // Show the saved answers and the new ratings (and the new score).
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h3 className="font-semibold text-slate-900">{t("review.questionsTitle")}</h3>
        <p className="text-sm text-slate-600">{t("review.questionsIntro")}</p>
      </div>
      <ol className="space-y-5">
        {questions.map((q, i) => {
          const changed = answers[i].trim() !== q.answer.trim();
          const fieldId = `answer-${i}`;
          return (
            <li key={i} className="space-y-1">
              <label htmlFor={fieldId} className="block font-medium text-slate-900">
                {i + 1}. {q.question}
              </label>
              <p className="text-sm text-slate-600">
                {t("review.whyAsked")}: {q.why}
              </p>
              <textarea
                id={fieldId}
                rows={3}
                maxLength={maxAnswerLength}
                value={answers[i]}
                placeholder={t("review.yourAnswer")}
                onChange={(event) => setAnswers(answers.map((a, j) => (j === i ? event.target.value : a)))}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400"
              />
              {q.rating && !changed ? (
                <div className="text-sm">
                  <span className={`rounded px-2 py-0.5 ${RATING_STYLE[q.rating.value]}`}>{t(`review.ratings.${q.rating.value}`)}</span>
                  <p className="mt-1 text-slate-700">{q.rating.feedback}</p>
                </div>
              ) : answers[i].trim() ? (
                <p className="text-sm text-slate-500">{t("review.notRated")}</p>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={check}
          disabled={working || !aiConfigured}
          className="rounded-md bg-violet-700 px-4 py-2 font-medium text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {working ? t("review.checking") : t("review.check")}
        </button>
        {message && (
          <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-red-700" : "text-green-800"}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
