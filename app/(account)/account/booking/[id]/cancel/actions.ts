"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { pingErrorMessage } from "@/lib/db/errors";
import { createClient } from "@/lib/db/server";

const input = z.object({
  seriesId: z.string().uuid(),
  shownFeePence: z.coerce.number().int().min(0).max(10_000_000),
});

export type CancelBlockState = { error?: string };

/**
 * Cancels every clean still to come in the customer's own block, at the total they were
 * shown, and ends the block. The database decides which cleans are late and what each costs
 * (public.cancel_block); the figure from the page only proves they agreed to the right one.
 * If it has changed, nothing is cancelled and the page shows the new figure.
 */
export async function cancelBlock(_prev: CancelBlockState, form: FormData): Promise<CancelBlockState> {
  await requireRole("customer", "/account");
  const p = input.safeParse({ seriesId: form.get("seriesId"), shownFeePence: form.get("shownFeePence") });
  if (!p.success) return { error: "That didn't go through. Go back to My cleans and try again." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_block", { p_series: p.data.seriesId, p_shown_fee_pence: p.data.shownFeePence });
  if (error) {
    if (error.code === "PC035" || error.code === "PC055") revalidatePath(`/account/booking/${p.data.seriesId}/cancel`);
    return { error: pingErrorMessage(error) };
  }
  revalidatePath("/account", "layout");
  redirect(`/account?cancelled=${p.data.shownFeePence > 0 ? "block-fee" : "block"}` as Route);
}
