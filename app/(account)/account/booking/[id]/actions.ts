"use server";

// A customer cancels a clean, or the rest of their block. The database decides everything:
// whose clean it is, whether it can still be cancelled, and whether it's late
// (cancel_my_visit / cancel_my_block, intent/cancel/plan.md). The ids from the browser are
// only ever looked up against the signed-in customer's own cleans.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { pingErrorMessage } from "@/lib/db/errors";
import { createClient } from "@/lib/db/server";

export type CancelResult = { ok: true; late: boolean; cancelled: number } | { ok: false; error: string };

// Any well-formed id: the database, not this pattern, decides whether it is the customer's.
const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const TRY_AGAIN = "We couldn’t cancel that just now. Nothing has changed. Please try again.";

async function customerClient() {
  const session = await getSession();
  return session && session.role === "customer" ? createClient() : null;
}

function refresh(seriesId: string) {
  revalidatePath("/account");
  revalidatePath(`/account/booking/${seriesId}`);
}

export async function cancelCleanAction(seriesId: string, visitId: string): Promise<CancelResult> {
  const series = id.safeParse(seriesId);
  const visit = id.safeParse(visitId);
  const supabase = await customerClient();
  if (!series.success || !visit.success || !supabase) return { ok: false, error: TRY_AGAIN };
  const done = await supabase.rpc("cancel_my_visit", { p_visit: visit.data });
  if (done.error) return { ok: false, error: pingErrorMessage(done.error) || TRY_AGAIN };
  refresh(series.data);
  return { ok: true, late: done.data === "cancelled_late", cancelled: 1 };
}

export async function cancelBlockAction(seriesId: string): Promise<CancelResult> {
  const series = id.safeParse(seriesId);
  const supabase = await customerClient();
  if (!series.success || !supabase) return { ok: false, error: TRY_AGAIN };
  const done = await supabase.rpc("cancel_my_block", { p_series: series.data });
  if (done.error || !done.data) return { ok: false, error: (done.error && pingErrorMessage(done.error)) || TRY_AGAIN };
  refresh(series.data);
  return { ok: true, late: done.data.late > 0, cancelled: done.data.cancelled };
}
