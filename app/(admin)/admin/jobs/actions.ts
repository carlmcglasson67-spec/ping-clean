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
  return error ? { ok: false, message: adminErrorMessage(error) } : done("Block ended. Cleans still booked from today were cancelled.");
}

const whatHappened = z.string().trim().max(300, "Keep it to 300 characters.").regex(/[\p{L}\p{N}]{3,}/u, "Say what happened, in a few words.");

/**
 * Settles a missed or unfinished clean: it was done, it wasn't, or (a missed clean only) the
 * cleaner couldn't get in. The database decides whether the clean can be settled and what
 * that does to the money (admin_settle_visit): "done" charges the customer and pays the
 * cleaner through the usual charge; "no access" charges the no-access fee settings say,
 * which the page was shown and sends back (feePence), with the office's choice when the
 * rule is "decide each time" (charge). Nothing else charges anyone.
 * `stale` means the clean has moved on since the page loaded (someone else settled it):
 * the page should be read again rather than tried again. `changed` means the cost of no
 * access has changed since the page loaded: the step stays open with the new figure.
 */
export async function settleClean(raw: unknown): Promise<ActionResult & { stale?: boolean; changed?: boolean }> {
  await requireRole("admin", "/admin/jobs");
  // wasNotDone is what the page was showing: a clean nobody had settled, or one already marked
  // as not done (the way back). The database refuses (PC056) if that is no longer true.
  const p = z.object({
    visitId: pgUuid,
    outcome: z.enum(["done", "not_done", "no_access"]),
    reason: whatHappened,
    wasNotDone: z.boolean(),
    feePence: z.number().int().min(0).max(1_000_000).optional(),
    charge: z.boolean().optional(),
  }).safeParse(raw);
  if (!p.success) return { ok: false, message: p.error.issues.find((i) => i.path[0] === "reason")?.message ?? NOT_SAVED };
  const noAccess = p.data.outcome === "no_access";
  if (noAccess && p.data.feePence === undefined) return { ok: false, message: NOT_SAVED };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_settle_visit", {
    p_visit: p.data.visitId, p_outcome: p.data.outcome, p_reason: p.data.reason, p_was_not_done: p.data.wasNotDone,
    ...(noAccess ? { p_fee_pence: p.data.feePence, ...(p.data.charge === undefined ? {} : { p_charge: p.data.charge }) } : {}),
  });
  if (error?.code === "PC056") return { ok: false, stale: true, message: "Someone on the team has already dealt with that clean." };
  if (error?.code === "PC068") return { ok: false, changed: true, message: adminErrorMessage(error) };
  if (error?.code === "PC057" && noAccess) return { ok: false, message: "That clean had no cleaner, so nobody went to the door." };
  if (error) return { ok: false, message: error.code === "22023" ? "Say what happened, in a few words (up to 300 characters)." : adminErrorMessage(error) };
  return done(p.data.outcome === "done" ? "Marked as done." : noAccess ? "Marked as couldn’t get in." : "Marked as not done.");
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
