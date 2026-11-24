import type { EmailOtpType } from "@supabase/supabase-js";
import { hasLocale } from "next-intl";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

/**
 * The login link in the email lands here. We swap the one-time code for a
 * session cookie, then send the user on to their plans.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const supabase = await createClient();

  // Default Supabase email link (PKCE): ?code=...
  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  // Custom email template variant: ?token_hash=...&type=...
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  const locale = next.split("/")[1];
  const loginLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  return NextResponse.redirect(`${origin}/${loginLocale}/login?error=link`);
}

/** Only allow paths on this site (blocks redirects to other websites). */
function safeNextPath(value: string | null): string {
  if (value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) {
    return value;
  }
  return `/${routing.defaultLocale}/plans`;
}
