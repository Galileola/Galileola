"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { status: "idle" | "sent" | "invalid" | "error" | "tooMany" | "notAllowed" };

const schema = z.object({
  email: z.email().max(254),
  locale: z.enum(routing.locales),
});

/** Sends a one-time login link to the email address. */
export async function sendLoginLink(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return { status: "invalid" };

  // Next.js checks that the Origin header matches the site, so it is safe to build the link from it.
  const origin = (await headers()).get("origin");
  if (!origin) return { status: "error" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=/${parsed.data.locale}/plans`,
    },
  });

  if (error) {
    // No email address in logs (GDPR): only the error code.
    console.error("Login link not sent", { code: error.code, status: error.status });
    // Too many login emails in a short time (Supabase limits them).
    if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
      return { status: "tooMany" };
    }
    // The built-in test email service only sends to the project team (until own email sending is set up).
    if (error.code === "email_address_not_authorized") return { status: "notAllowed" };
    return { status: "error" };
  }
  return { status: "sent" };
}
