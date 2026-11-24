import "server-only";
import { createClient } from "@/lib/supabase/server";

export type PlanSummary = {
  id: string;
  title: string;
  company_type: string;
  updated_at: string;
};

// Row-level security in the database makes sure each user only gets their own plans.

export async function listMyPlans(): Promise<PlanSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("plans")
    .select("id, title, company_type, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load plans (${error.code})`);
  return data;
}

/** The plan with its saved numbers (raw JSON; validate before use). */
export async function getMyPlanFinance(id: string): Promise<(PlanSummary & { finance: unknown }) | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("plans")
    .select("id, title, company_type, updated_at, finance")
    .eq("id", id)
    .maybeSingle();
  if (error && error.code !== "22P02") throw new Error(`Could not load plan (${error.code})`);
  return data ?? null;
}

/** The full plan: answers and numbers as raw JSON (validate before use). */
export async function getMyPlanFull(
  id: string,
): Promise<(PlanSummary & { answers: unknown; finance: unknown }) | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("plans")
    .select("id, title, company_type, updated_at, answers, finance")
    .eq("id", id)
    .maybeSingle();
  if (error && error.code !== "22P02") throw new Error(`Could not load plan (${error.code})`);
  return data ?? null;
}
