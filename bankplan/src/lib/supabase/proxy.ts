import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

/**
 * Refreshes the login session (if any) and writes updated cookies onto `response`.
 * Returns whether someone is signed in.
 */
export async function updateSession(request: NextRequest, response: NextResponse) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Must come right after creating the client: it validates and refreshes the session.
  const { data } = await supabase.auth.getClaims();
  return { signedIn: Boolean(data?.claims) };
}
