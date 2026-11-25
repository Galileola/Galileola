"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

export type LoginState =
  | { status: "idle" | "invalid" | "error" | "tooMany" | "notAllowed" }
  /** The email is kept only in the browser, so the code form knows where the code was sent. */
  | { status: "sent"; email: string };

export type CodeState = { status: "idle" | "invalid" | "wrongCode" | "tooMany" | "error" };

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
  return { status: "sent", email: parsed.data.email };
}

const codeSchema = z.object({
  email: z.email().max(254),
  // The code from the email; spaces typed or pasted with it are ignored.
  code: z.string().transform((v) => v.replace(/\s/g, "")).pipe(z.string().regex(/^\d{6,10}$/)),
  locale: z.enum(routing.locales),
});

/** Logs in with the code from the email (for reading the email on another device). */
export async function verifyLoginCode(_previous: CodeState, formData: FormData): Promise<CodeState> {
  const parsed = codeSchema.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    code: String(formData.get("code") ?? ""),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return { status: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email: parsed.data.email, token: parsed.data.code, type: "email" });
  if (error) {
    // No email address or code in logs (GDPR): only the error code.
    console.error("Login code not accepted", { code: error.code, status: error.status });
    if (error.status === 429 || error.code === "over_request_rate_limit") return { status: "tooMany" };
    if (error.code === "otp_expired" || error.status === 403 || error.status === 400) return { status: "wrongCode" };
    return { status: "error" };
  }
  redirect(`/${parsed.data.locale}/plans`);
}
