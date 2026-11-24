"use server";

import { z } from "zod";
import { routing } from "@/i18n/routing";
import { askClaude } from "@/lib/ai/claude";
import { buildTranslationMessage, buildTranslationPrompt } from "@/lib/ai/sectionPrompt";
import { getCurrentUser } from "@/lib/auth";
import { sectionsNeedingTranslation } from "@/lib/export/buildDocument";
import { MAX_TEXT_LENGTH, readPlanAnswers, textHash } from "@/lib/plan/answers";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({ planId: z.uuid(), lang: z.enum(routing.locales) });

export type TranslateResult = { status: "ok" | "invalid" | "error" | "notConfigured" | "refused" };

/**
 * Translates every section written in another language into the document language
 * and stores the translations next to the original texts (the originals stay as they are).
 */
export async function translateSections(raw: z.infer<typeof inputSchema>): Promise<TranslateResult> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid" };
  const { planId, lang } = parsed.data;
  if (!(await getCurrentUser())) return { status: "error" };

  const supabase = await createClient();
  const load = () => supabase.from("plans").select("answers").eq("id", planId).maybeSingle();
  const { data: plan, error } = await load();
  if (error || !plan) return { status: "error" };

  const answers = readPlanAnswers(plan.answers);
  const todo = sectionsNeedingTranslation(answers, lang);
  if (todo.length === 0) return { status: "ok" };
  const results = await Promise.all(
    todo.map(async (section) => {
      const answer = answers[section]!;
      const result = await askClaude({
        system: buildTranslationPrompt(answer.textLocale ?? lang, lang),
        user: buildTranslationMessage(answer.text),
        maxTokens: 8000,
        effort: "low",
      });
      return { section, sourceHash: textHash(answer.text), result };
    }),
  );

  // Load again just before saving, so edits made in the meantime are not lost.
  const { data: fresh, error: freshError } = await load();
  if (freshError || !fresh) return { status: "error" };
  const latest = readPlanAnswers(fresh.answers);
  for (const { section, sourceHash, result } of results) {
    const answer = latest[section];
    // Skip a translation if the section text was changed while it was being translated.
    if (result.status !== "ok" || !answer || textHash(answer.text) !== sourceHash) continue;
    answer.translations = { ...answer.translations, [lang]: { text: result.text.slice(0, MAX_TEXT_LENGTH * 2), sourceHash } };
  }
  const { error: updateError } = await supabase.from("plans").update({ answers: latest }).eq("id", planId);
  if (updateError) {
    console.error("Translations not saved", { code: updateError.code });
    return { status: "error" };
  }

  const failed = results.find((r) => r.result.status !== "ok");
  return failed ? { status: failed.result.status } : { status: "ok" };
}
