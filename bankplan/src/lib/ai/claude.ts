import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * The one place the app talks to Claude. Runs on the server only, so the API key
 * never reaches the browser. Needs two environment variables:
 *   ANTHROPIC_API_KEY  – the secret key
 *   ANTHROPIC_MODEL    – which Claude model to use
 * Optional:
 *   AI_DAILY_LIMIT_PER_USER – AI requests per person per day (default 60), to protect the AI bill
 */
export type AiResult = { status: "ok"; text: string } | AiProblem;
export type AiJsonResult<T> = { status: "ok"; data: T } | AiProblem;
type AiProblem = { status: "notConfigured" | "refused" | "error" | "limit" };

type AiRequest = {
  system: string;
  user: string;
  maxTokens: number;
  effort: "low" | "medium" | "high";
  /** How long to wait for one answer, in milliseconds (default 2 minutes). */
  timeoutMs?: number;
};

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_MODEL);
}

const DEFAULT_DAILY_LIMIT = 60;

function dailyLimit(): number {
  const value = Number(process.env.AI_DAILY_LIMIT_PER_USER);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_DAILY_LIMIT;
}

/** Counts this request for the signed-in person. Null = allowed, otherwise the problem to report. */
async function checkDailyLimit(): Promise<AiProblem | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("use_ai_call", { daily_limit: dailyLimit() });
  if (error) {
    console.error("AI limit check failed", { code: error.code });
    return { status: "error" };
  }
  return data === true ? null : { status: "limit" };
}

function request(options: AiRequest) {
  return {
    model: process.env.ANTHROPIC_MODEL!,
    max_tokens: options.maxTokens,
    // If the model declines a request, the API retries it on a fallback model by itself.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
    system: options.system,
    messages: [{ role: "user" as const, content: options.user }],
  };
}

const client = (options: AiRequest) => new Anthropic({ maxRetries: 2, timeout: options.timeoutMs ?? 120_000 });

/** Only the error type and status go to the logs, never the plan text (GDPR). */
function logFailure(error: unknown): AiProblem {
  if (error instanceof Anthropic.APIError) {
    console.error("AI request failed", { status: error.status ?? null, type: error.type ?? null });
  } else {
    console.error("AI request failed", { type: error instanceof Error ? error.name : "unknown" });
  }
  return { status: "error" };
}

function refused(response: { stop_reason: string | null; stop_details?: { category?: string | null } | null }): AiProblem | null {
  if (response.stop_reason !== "refusal") return null;
  console.error("AI refused", { category: response.stop_details?.category ?? null });
  return { status: "refused" };
}

/** Asks for plain text (the section writer, translations). */
export async function askClaude(options: AiRequest): Promise<AiResult> {
  if (!isAiConfigured()) return { status: "notConfigured" };
  const limited = await checkDailyLimit();
  if (limited) return limited;
  try {
    const response = await client(options).beta.messages.create({
      ...request(options),
      output_config: { effort: options.effort },
    });
    const refusal = refused(response);
    if (refusal) return refusal;
    const text = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("")
      .trim();
    if (!text) return { status: "error" };
    return { status: "ok", text };
  } catch (error) {
    return logFailure(error);
  }
}

/** Asks for an answer in a fixed shape (the bank officer). The answer is checked against the schema. */
export async function askClaudeJson<T>(options: AiRequest & { schema: z.ZodType<T> }): Promise<AiJsonResult<T>> {
  if (!isAiConfigured()) return { status: "notConfigured" };
  const limited = await checkDailyLimit();
  if (limited) return limited;
  try {
    const response = await client(options).beta.messages.parse({
      ...request(options),
      output_config: { effort: options.effort, format: betaZodOutputFormat(options.schema) },
    });
    const refusal = refused(response);
    if (refusal) return refusal;
    if (response.stop_reason === "max_tokens" || response.parsed_output == null) {
      console.error("AI answer incomplete", { stopReason: response.stop_reason });
      return { status: "error" };
    }
    return { status: "ok", data: response.parsed_output as T };
  } catch (error) {
    return logFailure(error);
  }
}
