"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { pingErrorMessage } from "@/lib/db/errors";
import { createClient } from "@/lib/db/server";

const input = z.object({
  visitId: z.string().uuid(),
  shownFeePence: z.coerce.number().int().min(0).max(1_000_000),
});

export type CancelState = { error?: string; changed?: boolean };

/**
 * Cancels one of the customer's own cleans at the fee they were shown. The database decides
 * whether it's late and what it costs (public.cancel_visit); the figure from the page is only
 * used to check they agreed to the right one. If it has changed, nothing is cancelled and
 * the page shows the new figure.
 */
export async function cancelClean(_prev: CancelState, form: FormData): Promise<CancelState> {
  await requireRole("customer", "/account");
  const p = input.safeParse({ visitId: form.get("visitId"), shownFeePence: form.get("shownFeePence") });
  if (!p.success) return { error: "That didn't go through. Go back to My cleans and try again." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_visit", { p_visit: p.data.visitId, p_shown_fee_pence: p.data.shownFeePence });
  if (error?.code === "PC035") {
    revalidatePath(`/account/clean/${p.data.visitId}/cancel`);
    return { changed: true, error: pingErrorMessage(error) };
  }
  if (error) return { error: pingErrorMessage(error) };
  revalidatePath("/account", "layout");
  redirect(`/account?cancelled=${data === "cancelled_with_fee" ? "fee" : "free"}` as Route);
}
