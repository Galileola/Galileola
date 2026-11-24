import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = { id: string; email: string | null };

/** The signed-in user, or null. Checks the session with Supabase on the server. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
}

/** Like getCurrentUser, but sends visitors who are not signed in to the login page. */
export async function requireUser(locale: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  return user;
}
