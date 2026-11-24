"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { Locale } from "@/i18n/routing";
import { MAX_ANSWER_LENGTH, MAX_TEXT_LENGTH } from "@/lib/plan/answers";
import { bankLoanQuestions, sectionsUsingNumbers, type BankLoanSection } from "@/plan-types/bank-loan/sections";
import { saveSection, writeSectionWithAi, type SectionInput } from "./actions";

type Props = {
  planId: string;
  section: BankLoanSection;
  initialAnswers: Record<string, string>;
  initialText: string;
  aiConfigured: boolean;
};

type Message = { kind: "ok" | "error"; text: string } | null;

export function StepForm({ planId, section, initialAnswers, initialText, aiConfigured }: Props) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [text, setText] = useState(initialText);
  const [message, setMessage] = useState<Message>(null);
  const [saving, startSaving] = useTransition();
  const [writing, startWriting] = useTransition();
  const busy = saving || writing;
  const questions = bankLoanQuestions[section];

  const payload = (): SectionInput => ({ planId, section, locale, q: answers, text });

  function save() {
    startSaving(async () => {
      const result = await saveSection(payload());
      setMessage(
        result.status === "saved"
          ? { kind: "ok", text: t("wizard.saved") }
          : { kind: "error", text: t("wizard.saveError") },
      );
    });
  }

  function writeWithAi() {
    setMessage(null);
    startWriting(async () => {
      const result = await writeSectionWithAi(payload());
      if (result.status === "ok") {
        setText(result.text);
        setMessage({ kind: "ok", text: t("wizard.saved") });
        return;
      }
      const errors = {
        needAnswers: "wizard.aiNeedAnswers",
        notConfigured: "wizard.aiNotConfigured",
        refused: "wizard.aiRefused",
        invalid: "wizard.saveError",
        error: "wizard.aiError",
      } as const;
      setMessage({ kind: "error", text: t(errors[result.status]) });
    });
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{t("wizard.answersTitle")}</h2>
          <p className="text-sm text-slate-600">{t("wizard.answersHint")}</p>
          {section === "summary" && <p className="mt-1 text-sm text-blue-800">{t("wizard.summaryHint")}</p>}
          {section !== "summary" && sectionsUsingNumbers.includes(section) && (
            <p className="mt-1 text-sm text-blue-800">{t("wizard.numbersHint")}</p>
          )}
        </div>
        {questions.map((id) => {
          const key = `questions.${section}.${id}` as "questions.idea.product";
          const fieldId = `q-${id}`;
          return (
            <div key={id} className="space-y-1">
              <label htmlFor={fieldId} className="block font-medium text-slate-800">
                {t(`${key}.label`)}
              </label>
              <textarea
                id={fieldId}
                rows={3}
                maxLength={MAX_ANSWER_LENGTH}
                value={answers[id] ?? ""}
                placeholder={t(`${key}.example`)}
                onChange={(event) => setAnswers({ ...answers, [id]: event.target.value })}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400"
              />
            </div>
          );
        })}
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{t("wizard.textTitle")}</h2>
            <p className="text-sm text-slate-600">{t("wizard.textHint")}</p>
          </div>
          <button
            type="button"
            onClick={writeWithAi}
            disabled={busy || !aiConfigured}
            className="rounded-md bg-violet-700 px-4 py-2 font-medium text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {writing ? t("wizard.aiWriting") : text.trim() ? t("wizard.aiRewrite") : t("wizard.aiWrite")}
          </button>
        </div>
        {!aiConfigured && <p className="text-sm text-amber-800">{t("wizard.aiNotConfigured")}</p>}
        <textarea
          aria-label={t("wizard.textTitle")}
          rows={12}
          maxLength={MAX_TEXT_LENGTH}
          value={text}
          placeholder={t("wizard.textEmpty")}
          onChange={(event) => setText(event.target.value)}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 placeholder:text-slate-400"
        />
        <p className="text-sm text-slate-600">{t("wizard.checkNote")}</p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? t("wizard.saving") : t("wizard.save")}
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
