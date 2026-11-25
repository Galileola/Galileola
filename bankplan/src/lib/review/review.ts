/**
 * The bank officer check as saved with the plan (column plans.review):
 * the officer's summary, weak points and questions, the owner's answers and their ratings.
 */
import { z } from "zod";
import { routing, type Locale } from "@/i18n/routing";
import type { OfficerReview } from "@/lib/ai/officerPrompt";
import { textHash, type PlanAnswers } from "@/lib/plan/answers";
import { bankLoanSections } from "@/plan-types/bank-loan/sections";
import { ratings, type Rating } from "./readiness";

export const QUESTION_COUNT = 10;
export const MAX_INTERVIEW_ANSWER = 3000;

const storedQuestion = z.object({
  question: z.string().max(1000),
  why: z.string().max(1000),
  answer: z.string().max(MAX_INTERVIEW_ANSWER),
  /** The rating counts only while the answer is unchanged (answerHash). */
  rating: z
    .object({ value: z.enum(ratings), feedback: z.string().max(2000), answerHash: z.string().max(20) })
    .optional(),
});

export const storedReviewSchema = z.object({
  version: z.literal(1),
  /** Language the officer wrote in. */
  locale: z.enum(routing.locales),
  createdAt: z.string().max(40),
  /** Fingerprint of the plan texts and numbers when the check was made. */
  planHash: z.string().max(20),
  summary: z.string().max(3000),
  weakPoints: z
    .array(z.object({ title: z.string().max(300), explanation: z.string().max(2000), fix: z.string().max(2000) }))
    .max(10),
  questions: z.array(storedQuestion).max(QUESTION_COUNT),
});

export type StoredReview = z.infer<typeof storedReviewSchema>;
export type StoredQuestion = z.infer<typeof storedQuestion>;

/** The saved check, or null if there is none (or it is damaged). */
export function readReview(raw: unknown): StoredReview | null {
  const parsed = storedReviewSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Fingerprint of everything the officer read: section texts and numbers. */
export function planFingerprint(answers: PlanAnswers, finance: unknown): string {
  return textHash(JSON.stringify([bankLoanSections.map((s) => answers[s]?.text ?? ""), finance ?? null]));
}

export const answerHash = (answer: string) => textHash(answer.trim());

/** The rating of an answer, or null if it is unanswered, not rated yet, or changed since the rating. */
export function currentRating(question: StoredQuestion): Rating | null {
  if (!question.answer.trim() || !question.rating) return null;
  return question.rating.answerHash === answerHash(question.answer) ? question.rating.value : null;
}

/** Fits the AI's review into the saved format (at most 10 questions, texts cut to the limits). */
export function toStoredReview(review: OfficerReview, locale: Locale, planHash: string, now: Date): StoredReview {
  const cut = (text: string, max: number) => text.trim().slice(0, max);
  return {
    version: 1,
    locale,
    createdAt: now.toISOString(),
    planHash,
    summary: cut(review.summary, 3000),
    weakPoints: review.weakPoints.slice(0, 10).map((w) => ({
      title: cut(w.title, 300),
      explanation: cut(w.explanation, 2000),
      fix: cut(w.fix, 2000),
    })),
    questions: review.questions
      .filter((q) => q.question.trim())
      .slice(0, QUESTION_COUNT)
      .map((q) => ({ question: cut(q.question, 1000), why: cut(q.why, 1000), answer: "" })),
  };
}
