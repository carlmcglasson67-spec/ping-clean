"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";
import { adminErrorMessage, NOT_SAVED, type ActionResult } from "../_lib/errors";
import { pgUuid } from "../_lib/ids";

// Every action here calls the engine's own admin function: the rules (who can be assigned,
// what a reopen does to booked cleans, how a block ends) live in the database, not here.
// Each one is audited by the series trigger with the admin as the actor.

const reason = z.string().trim().max(300, "Keep it to 300 characters.").regex(/[\p{L}\p{N}]{3,}/u, "Say why, in a few words.");

function done(message: string): ActionResult {
  revalidatePath("/admin", "layout");
  return { ok: true, message };
}

export async function assignBlock(raw: unknown): Promise<ActionResult> {
  await requireRole("admin", "/admin/jobs");
  const p = z.object({ seriesId: pgUuid, cleanerId: pgUuid }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Choose a cleaner first." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_assign_series", { p_series: p.data.seriesId, p_cleaner: p.data.cleanerId });
  return error ? { ok: false, message: adminErrorMessage(error) } : done("Assigned. Every clean of the block is booked in for them.");
}

export async function reopenBlock(raw: unknown): Promise<ActionResult> {
  await requireRole("admin", "/admin/jobs");
  const p = z.object({ seriesId: pgUuid }).safeParse(raw);
  if (!p.success) return { ok: false, message: NOT_SAVED };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reopen_series", { p_series: p.data.seriesId });
  return error ? { ok: false, message: adminErrorMessage(error) } : done("Back on the board. Offers start again from Top cleaners.");
}

export async function endBlock(raw: unknown): Promise<ActionResult> {
  await requireRole("admin", "/admin/jobs");
  const p = z.object({ seriesId: pgUuid, reason }).safeParse(raw);
  if (!p.success) return { ok: false, message: p.error.issues.find((i) => i.path[0] === "reason")?.message ?? NOT_SAVED };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_end_block", { p_series: p.data.seriesId, p_reason: p.data.reason });
  return error ? { ok: false, message: adminErrorMessage(error) } : done("Block ended. Cleans still booked from today were removed.");
}

/** Marks an alert dealt with. Only an open one: two of the team can't both resolve it. */
export async function resolveAlert(raw: unknown): Promise<ActionResult> {
  const session = await requireRole("admin", "/admin/jobs");
  const p = z.object({ alertId: pgUuid }).safeParse(raw);
  if (!p.success) return { ok: false, message: NOT_SAVED };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("engine_alerts")
    .update({ resolved_at: new Date().toISOString(), resolved_by: session.userId })
    .eq("id", p.data.alertId)
    .is("resolved_at", null)
    .select("id");
  if (error) return { ok: false, message: adminErrorMessage(error) };
  if (!data?.length) return { ok: false, message: "Someone on the team has already resolved that one." };
  return done("Resolved.");
}
