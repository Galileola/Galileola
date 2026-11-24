import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * The one place the app talks to Claude. Runs on the server only, so the API key
 * never reaches the browser. Needs two environment variables:
 *   ANTHROPIC_API_KEY  – the secret key
 *   ANTHROPIC_MODEL    – which Claude model to use
 */
export type AiResult =
  | { status: "ok"; text: string }
  | { status: "notConfigured" | "refused" | "error" };

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_MODEL);
}

export async function askClaude(options: {
  system: string;
  user: string;
  maxTokens: number;
  effort: "low" | "medium" | "high";
}): Promise<AiResult> {
  if (!isAiConfigured()) return { status: "notConfigured" };

  const client = new Anthropic({ maxRetries: 2, timeout: 120_000 });
  try {
    const response = await client.beta.messages.create({
      model: process.env.ANTHROPIC_MODEL!,
      max_tokens: options.maxTokens,
      // If the model declines a request, the API retries it on a fallback model by itself.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: options.effort },
      system: options.system,
      messages: [{ role: "user", content: options.user }],
    });

    if (response.stop_reason === "refusal") {
      console.error("AI refused", { category: response.stop_details?.category ?? null });
      return { status: "refused" };
    }
    const text = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("")
      .trim();
    if (!text) return { status: "error" };
    return { status: "ok", text };
  } catch (error) {
    // Only the error type and status go to the logs, never the plan text (GDPR).
    if (error instanceof Anthropic.APIError) {
      console.error("AI request failed", { status: error.status ?? null, type: error.type ?? null });
    } else {
      console.error("AI request failed", { type: error instanceof Error ? error.name : "unknown" });
    }
    return { status: "error" };
  }
}
