"use server";

import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { companyTypes, type CompanyType } from "@/config/countries/ee";
import { routing } from "@/i18n/routing";
import { askClaude } from "@/lib/ai/claude";
import { buildSystemPrompt, buildUserMessage } from "@/lib/ai/sectionPrompt";
import { getCurrentUser } from "@/lib/auth";
import { keyNumbers } from "@/lib/finance/keyNumbers";
import {
  cleanSectionAnswers,
  MAX_ANSWER_LENGTH,
  MAX_TEXT_LENGTH,
  readPlanAnswers,
  type PlanAnswers,
} from "@/lib/plan/answers";
import { createClient } from "@/lib/supabase/server";
import {
  bankLoanQuestions,
  bankLoanSections,
  sectionsUsingNumbers,
  type BankLoanSection,
} from "@/plan-types/bank-loan/sections";

const inputSchema = z.object({
  planId: z.uuid(),
  section: z.enum(bankLoanSections),
  locale: z.enum(routing.locales),
  q: z.record(z.string().max(40), z.string().max(MAX_ANSWER_LENGTH)),
  text: z.string().max(MAX_TEXT_LENGTH),
});

export type SectionInput = z.infer<typeof inputSchema>;
export type SaveSectionResult = { status: "saved" | "invalid" | "error" };
export type WriteSectionResult =
  | { status: "ok"; text: string }
  | { status: "invalid" | "error" | "needAnswers" | "notConfigured" | "refused" };

/** Loads the plan (row-level security: only the owner's) and stores this section's answers. */
async function storeSection(input: SectionInput, text: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data: plan, error } = await supabase
    .from("plans")
    .select("id, title, company_type, answers, finance")
    .eq("id", input.planId)
    .maybeSingle();
  if (error || !plan) return null;

  const answers: PlanAnswers = readPlanAnswers(plan.answers);
  answers[input.section] = {
    q: cleanSectionAnswers(input.section, input.q),
    text,
    ...(text.trim() ? { textLocale: input.locale } : {}),
  };
  const { error: updateError } = await supabase.from("plans").update({ answers }).eq("id", input.planId);
  if (updateError) {
    console.error("Answers not saved", { code: updateError.code });
    return null;
  }
  return { plan, answers };
}

export async function saveSection(raw: SectionInput): Promise<SaveSectionResult> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid" };
  const stored = await storeSection(parsed.data, parsed.data.text);
  return { status: stored ? "saved" : "error" };
}

/** Saves the answers, asks the AI to write the section text, and saves that text too. */
export async function writeSectionWithAi(raw: SectionInput): Promise<WriteSectionResult> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid" };
  const input = parsed.data;

  const stored = await storeSection(input, input.text);
  if (!stored) return { status: "error" };
  const { plan, answers } = stored;
  const section: BankLoanSection = input.section;

  const t = await getTranslations({ locale: input.locale });
  const notes = bankLoanQuestions[section]
    .map((id) => ({
      question: t(`questions.${section}.${id}.label` as "questions.idea.product.label"),
      answer: (answers[section]?.q[id] ?? "").trim(),
    }))
    .filter((note) => note.answer.length > 0);

  const otherSections =
    section === "summary"
      ? bankLoanSections
          .filter((s) => s !== "summary" && answers[s]?.text.trim())
          .map((s) => ({ title: t(`sections.${s}.title`), text: answers[s]!.text }))
      : [];
  if (notes.length === 0 && otherSections.length === 0) return { status: "needAnswers" };

  const companyType: CompanyType = (companyTypes as readonly string[]).includes(plan.company_type)
    ? (plan.company_type as CompanyType)
    : "OU";

  const result = await askClaude({
    system: buildSystemPrompt(input.locale),
    user: buildUserMessage({
      locale: input.locale,
      planTitle: plan.title,
      businessForm: companyType === "FIE" ? "FIE (sole proprietor)" : "OÜ (private limited company)",
      sectionTitle: t(`sections.${section}.title`),
      bankLooksFor: t(`sections.${section}.hint`),
      answers: notes,
      numbers: sectionsUsingNumbers.includes(section) ? keyNumbers(plan.finance, companyType) : [],
      otherSections,
    }),
    maxTokens: 4000,
    effort: "low",
  });
  if (result.status !== "ok") return { status: result.status };

  const text = result.text.slice(0, MAX_TEXT_LENGTH);
  const saved = await storeSection(input, text);
  return saved ? { status: "ok", text } : { status: "error" };
}
