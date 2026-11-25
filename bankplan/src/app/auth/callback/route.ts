import type { EmailOtpType } from "@supabase/supabase-js";
import { hasLocale } from "next-intl";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

/**
 * The login link in the email lands here. We swap the one-time token for a
 * session cookie, then send the user on to their plans.
 * The email link carries token_hash (set in the Supabase email template), so it works
 * on any device or browser, not only in the browser where the link was requested.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const supabase = await createClient();

  // Older style link (only works in the browser that asked for it): ?code=...
  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return redirectTo(next);
  }

  // Our email template: ?token_hash=...&type=email
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return redirectTo(next);
  }

  // Without a language in the address, the language step picks one (cookie or browser language).
  const locale = next.split("/")[1];
  return redirectTo(hasLocale(routing.locales, locale) ? `/${locale}/login?error=link` : "/login?error=link");
}

/**
 * A redirect to a path on this site. The address is relative on purpose: behind the
 * hosting's proxy the server only knows its internal address (such as 0.0.0.0:3000),
 * so the browser fills in the real one.
 */
function redirectTo(path: string) {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}

/** Only allow paths on this site (blocks redirects to other websites). */
function safeNextPath(value: string | null): string {
  if (value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) {
    return value;
  }
  return "/plans";
}
