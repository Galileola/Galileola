import { z } from "zod";
import { routing } from "@/i18n/routing";
import { bankLoanQuestions, bankLoanSections, type BankLoanSection } from "@/plan-types/bank-loan/sections";

/** Longest answer to one question, and longest section text (characters). */
export const MAX_ANSWER_LENGTH = 3000;
export const MAX_TEXT_LENGTH = 12000;

const sectionAnswerSchema = z.object({
  /** The owner's answers, by question id. */
  q: z.record(z.string().max(40), z.string().max(MAX_ANSWER_LENGTH)),
  /** The section text that goes into the plan (written by the AI and/or edited by the owner). */
  text: z.string().max(MAX_TEXT_LENGTH),
  /** Language the text is written in. */
  textLocale: z.enum(routing.locales).optional(),
  /** AI translations of `text` for the export, by language. Stale once `text` changes. */
  translations: z
    .partialRecord(
      z.enum(routing.locales),
      z.object({ text: z.string().max(MAX_TEXT_LENGTH * 2), sourceHash: z.string().max(20) }),
    )
    .optional(),
});

/** Stored in plans.answers. Sections that were never opened are missing. */
export const planAnswersSchema = z.partialRecord(z.enum(bankLoanSections), sectionAnswerSchema);

export type SectionAnswer = z.infer<typeof sectionAnswerSchema>;
export type PlanAnswers = z.infer<typeof planAnswersSchema>;

/** Reads stored answers; anything malformed is dropped instead of breaking the page. */
export function readPlanAnswers(raw: unknown): PlanAnswers {
  const parsed = planAnswersSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/** Keeps only the questions that belong to the section. */
export function cleanSectionAnswers(section: BankLoanSection, q: Record<string, string>): Record<string, string> {
  const allowed: readonly string[] = bankLoanQuestions[section];
  return Object.fromEntries(Object.entries(q).filter(([id]) => allowed.includes(id)));
}

export function hasAnyAnswer(answer: SectionAnswer | undefined): boolean {
  return Boolean(answer && Object.values(answer.q).some((value) => value.trim().length > 0));
}

/** Short fingerprint of a text (FNV-1a), to tell whether a stored translation still matches it. */
export function textHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
