"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const localeSchema = z.enum(routing.locales);

export async function logOut(formData: FormData) {
  const locale = localeSchema.catch(routing.defaultLocale).parse(formData.get("locale"));
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/${locale}`);
}

export type DeleteAccountState = { status: "idle" | "error" };

/** GDPR: deletes the login and, through the database, every plan of this user. */
export async function deleteAccount(_previous: DeleteAccountState, formData: FormData): Promise<DeleteAccountState> {
  const locale = localeSchema.catch(routing.defaultLocale).parse(formData.get("locale"));
  if (formData.get("confirm") !== "yes") return { status: "error" };

  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_my_account");
  if (error) {
    console.error("Account not deleted", { code: error.code });
    return { status: "error" };
  }

  // The login no longer exists; clear the session cookies in this browser.
  await supabase.auth.signOut({ scope: "local" });
  redirect(`/${locale}?deleted=1`);
}
