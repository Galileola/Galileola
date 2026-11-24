"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { companyTypes } from "@/config/countries/ee";
import { routing } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type CreatePlanState = { status: "idle" | "invalid" | "error" };

const schema = z.object({
  title: z.string().trim().min(1).max(200),
  companyType: z.enum(companyTypes),
  locale: z.enum(routing.locales),
});

export async function createPlan(_previous: CreatePlanState, formData: FormData): Promise<CreatePlanState> {
  const parsed = schema.safeParse({
    title: formData.get("title"),
    companyType: formData.get("companyType"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return { status: "invalid" };

  // Check the session again here: never trust the browser.
  const user = await getCurrentUser();
  if (!user) redirect(`/${parsed.data.locale}/login`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("plans")
    .insert({ title: parsed.data.title, company_type: parsed.data.companyType })
    .select("id")
    .single();

  if (error) {
    console.error("Plan not created", { code: error.code });
    return { status: "error" };
  }
  redirect(`/${parsed.data.locale}/plans/${data.id}`);
}
