"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { financeInputsSchema } from "@/lib/finance/inputs";
import { createClient } from "@/lib/supabase/server";

export type SaveFinanceResult = { status: "saved" | "invalid" | "error" };

/** Saves the numbers of one plan. Row-level security makes sure it is the user's own plan. */
export async function saveFinance(planId: string, inputs: unknown): Promise<SaveFinanceResult> {
  if (!z.uuid().safeParse(planId).success) return { status: "invalid" };
  const parsed = financeInputsSchema.safeParse(inputs);
  if (!parsed.success) return { status: "invalid" };

  const user = await getCurrentUser();
  if (!user) return { status: "error" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("plans")
    .update({ finance: parsed.data })
    .eq("id", planId)
    .select("id");

  if (error || !data?.length) {
    console.error("Finance not saved", { code: error?.code ?? "no_row" });
    return { status: "error" };
  }
  return { status: "saved" };
}
