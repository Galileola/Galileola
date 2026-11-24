import { hasLocale } from "next-intl";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { updateSession } from "./lib/supabase/proxy";

const handleLanguage = createMiddleware(routing);

/** Pages that need a signed-in user (path without the language prefix). */
const PROTECTED = ["/plans", "/settings"];

export async function proxy(request: NextRequest) {
  // 1. Language: adds /et, /ru or /en to the address when missing.
  const response = handleLanguage(request);

  // 2. Login session: refresh it and write the cookies onto the response.
  const { signedIn } = await updateSession(request, response);

  // 3. Protected pages: send visitors who are not signed in to the login page.
  const [, locale, ...rest] = request.nextUrl.pathname.split("/");
  const path = `/${rest.join("/")}`;
  const isProtected = PROTECTED.some((p) => path === p || path.startsWith(`${p}/`));

  if (!signedIn && hasLocale(routing.locales, locale) && isProtected) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = `/${locale}/login`;
    loginUrl.search = "";
    const redirect = NextResponse.redirect(loginUrl);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}

export const config = {
  // Everything except API routes, the login callback, Next.js internals and files with an extension.
  matcher: ["/((?!api|auth|_next|_vercel|.*\\..*).*)"],
};
