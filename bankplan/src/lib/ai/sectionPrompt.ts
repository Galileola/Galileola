/**
 * Builds the request for the AI text helper. Kept separate from the API call
 * so it can be tested without calling the AI.
 */
import type { Locale } from "@/i18n/routing";

export const LANGUAGE_NAMES: Record<Locale, string> = { et: "Estonian", ru: "Russian", en: "English" };

/** Start of the note the AI adds when something a bank expects is missing. */
const MISSING_NOTE: Record<Locale, string> = { et: "[Lisa: ", ru: "[Добавьте: ", en: "[Add: " };

export type SectionPromptInput = {
  locale: Locale;
  planTitle: string;
  /** "OÜ (private limited company)" or "FIE (sole proprietor)". */
  businessForm: string;
  sectionTitle: string;
  bankLooksFor: string;
  answers: { question: string; answer: string }[];
  /** Key figures from the calculator, one per line. */
  numbers?: string[];
  /** For the summary: the other sections' texts. */
  otherSections?: { title: string; text: string }[];
};

export function buildSystemPrompt(locale: Locale): string {
  return [
    "You help small-business owners in Estonia write the business plan they give to a bank with a loan application.",
    "You get the owner's rough notes for one section of the plan. Turn them into clear, professional text that a credit officer at an Estonian bank can read quickly.",
    "",
    "Rules:",
    `- Write in ${LANGUAGE_NAMES[locale]}. Use plain, simple words and short sentences.`,
    "- Use only facts from the owner's notes, the plan numbers and the other sections. Never invent numbers, names, customers, agreements, dates or claims.",
    `- If something a bank would expect in this section is missing, end with one short line that starts with "${MISSING_NOTE[locale]}" and says what to add, then "]".`,
    "- Be factual and calm. No marketing language. If the owner mentions a weakness, keep it and say how it is handled.",
    "- Format: plain text. Paragraphs separated by one blank line. Lists only as lines starting with \"- \". No headings, no bold, no tables.",
    "- Length: about 80 to 250 words. Shorter if the notes are short.",
    "- Reply with the section text only.",
  ].join("\n");
}

const escape = (text: string) => text.replaceAll("<", "‹").replaceAll(">", "›");

export function buildUserMessage(input: SectionPromptInput): string {
  const parts = [
    "<plan>",
    `Plan name: ${escape(input.planTitle)}`,
    `Business form: ${input.businessForm}`,
    "</plan>",
    "<section>",
    `Title: ${input.sectionTitle}`,
    `What the bank looks for: ${input.bankLooksFor}`,
    "</section>",
  ];
  if (input.numbers?.length) {
    parts.push("<plan_numbers>", ...input.numbers, "</plan_numbers>");
  }
  if (input.otherSections?.length) {
    parts.push("<other_sections>");
    for (const section of input.otherSections) {
      parts.push(`<section_text title="${section.title}">`, escape(section.text), "</section_text>");
    }
    parts.push("</other_sections>");
  }
  parts.push("<owner_notes>");
  for (const { question, answer } of input.answers) {
    parts.push(`Question: ${question}`, `Answer: ${escape(answer)}`, "");
  }
  parts.push("</owner_notes>", "", `Write the "${input.sectionTitle}" section now.`);
  return parts.join("\n");
}
