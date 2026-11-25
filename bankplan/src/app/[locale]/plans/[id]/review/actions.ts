"use server";

import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { companyTypes, type CompanyType } from "@/config/countries/ee";
import { routing } from "@/i18n/routing";
import { askClaudeJson } from "@/lib/ai/claude";
import {
  buildGradingMessage,
  buildGradingSystemPrompt,
  buildOfficerSystemPrompt,
  buildReviewMessage,
  gradingSchema,
  officerReviewSchema,
  type PlanContext,
} from "@/lib/ai/officerPrompt";
import { getCurrentUser } from "@/lib/auth";
import { keyNumbers } from "@/lib/finance/keyNumbers";
import { readPlanAnswers } from "@/lib/plan/answers";
import { checkPlan } from "@/lib/review/readiness";
import {
  answerHash,
  currentRating,
  MAX_INTERVIEW_ANSWER,
  planFingerprint,
  QUESTION_COUNT,
  readReview,
  toStoredReview,
} from "@/lib/review/review";
import { createClient } from "@/lib/supabase/server";
import { bankLoanSections } from "@/plan-types/bank-loan/sections";

export type ReviewResult = { status: "ok" | "invalid" | "error" | "notConfigured" | "refused" | "needPlan" };

const startSchema = z.object({ planId: z.uuid(), locale: z.enum(routing.locales) });
const answersSchema = z.object({
  planId: z.uuid(),
  locale: z.enum(routing.locales),
  /** The createdAt of the check being answered, so answers never land on a newer check. */
  reviewCreatedAt: z.string().max(40),
  answers: z.array(z.string().max(MAX_INTERVIEW_ANSWER)).max(QUESTION_COUNT),
});

/** Loads the owner's plan (row-level security) and what the officer needs to see. */
async function loadPlan(planId: string) {
  if (!(await getCurrentUser())) return null;
  const supabase = await createClient();
  const { data: plan, error } = await supabase
    .from("plans")
    .select("id, title, company_type, answers, finance, review")
    .eq("id", planId)
    .maybeSingle();
  if (error || !plan) return null;

  const companyType: CompanyType = (companyTypes as readonly string[]).includes(plan.company_type)
    ? (plan.company_type as CompanyType)
    : "OU";
  const answers = readPlanAnswers(plan.answers);
  const checks = checkPlan(answers, plan.finance, companyType);
  // Section titles in English for the officer; the texts stay in the language they were written in.
  const en = await getTranslations({ locale: "en" });
  const context: PlanContext = {
    planTitle: plan.title,
    businessForm: companyType === "FIE" ? "FIE (sole proprietor)" : "OÜ (private limited company)",
    sections: bankLoanSections
      .filter((s) => answers[s]?.text.trim())
      .map((s) => ({ title: en(`sections.${s}.title`), text: answers[s]!.text })),
    numbers: keyNumbers(plan.finance, companyType),
    checks,
  };
  return { supabase, plan, answers, context };
}

/** The AI officer reads the plan and writes its summary, weak points and 10 questions. Replaces an earlier check. */
export async function startReview(raw: z.infer<typeof startSchema>): Promise<ReviewResult> {
  const parsed = startSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid" };
  const { planId, locale } = parsed.data;

  const loaded = await loadPlan(planId);
  if (!loaded) return { status: "error" };
  const { supabase, plan, answers, context } = loaded;
  if (context.sections.length === 0 && context.numbers.length === 0) return { status: "needPlan" };

  const result = await askClaudeJson({
    system: buildOfficerSystemPrompt(locale),
    user: buildReviewMessage(context),
    schema: officerReviewSchema,
    maxTokens: 16000,
    effort: "medium",
    timeoutMs: 240_000,
  });
  if (result.status !== "ok") return { status: result.status };
  if (result.data.questions.length === 0) return { status: "error" };

  const review = toStoredReview(result.data, locale, planFingerprint(answers, plan.finance), new Date());
  const { error } = await supabase.from("plans").update({ review }).eq("id", planId);
  if (error) {
    console.error("Review not saved", { code: error.code });
    return { status: "error" };
  }
  return { status: "ok" };
}

/** Saves the answers, then the AI officer rates every new or changed answer. */
export async function checkAnswers(raw: z.infer<typeof answersSchema>): Promise<ReviewResult> {
  const parsed = answersSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid" };
  const input = parsed.data;

  const loaded = await loadPlan(input.planId);
  if (!loaded) return { status: "error" };
  const { supabase, plan, context } = loaded;
  const review = readReview(plan.review);
  if (!review || review.createdAt !== input.reviewCreatedAt || input.answers.length !== review.questions.length) {
    return { status: "invalid" };
  }

  // 1. Save the answers first, so nothing typed is lost if the AI fails.
  review.questions = review.questions.map((q, i) => ({ ...q, answer: input.answers[i].trim() }));
  const save = async () => {
    const { error } = await supabase.from("plans").update({ review }).eq("id", input.planId);
    if (error) console.error("Answers not saved", { code: error.code });
    return !error;
  };
  if (!(await save())) return { status: "error" };

  // 2. Rate the answers that are new or changed since their last rating.
  const toRate = review.questions
    .map((q, i) => ({ number: i + 1, question: q.question, answer: q.answer }))
    .filter((item) => item.answer && currentRating(review.questions[item.number - 1]) === null);
  if (toRate.length === 0) return { status: "ok" };

  const result = await askClaudeJson({
    system: buildGradingSystemPrompt(input.locale),
    user: buildGradingMessage(context, toRate),
    schema: gradingSchema,
    maxTokens: 8000,
    effort: "low",
    timeoutMs: 180_000,
  });
  if (result.status !== "ok") return { status: result.status };

  const wanted = new Set(toRate.map((item) => item.number));
  for (const rating of result.data.ratings) {
    if (!wanted.has(rating.number)) continue;
    const question = review.questions[rating.number - 1];
    question.rating = { value: rating.rating, feedback: rating.feedback.trim().slice(0, 2000), answerHash: answerHash(question.answer) };
  }
  return (await save()) ? { status: "ok" } : { status: "error" };
}
