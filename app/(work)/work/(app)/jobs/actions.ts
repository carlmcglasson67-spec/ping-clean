"use server";

import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";
import { pgUuid } from "../../_lib/ids";
import { claimOutcome, type ClaimResult } from "../../_lib/claim";

const input = z.object({ offerId: pgUuid, seriesId: pgUuid });

/**
 * Claims a regular clean, through claim_series(): the first eligible cleaner wins,
 * atomically, with eligibility re-checked at that moment. Nothing about the claim is
 * decided here; this only turns the database's answer into plain words.
 *
 * A retry after a dropped connection is safe: if the first tap did go through, the
 * database says "already claimed", we see the series is ours, and report success.
 */
export async function claimJob(raw: unknown): Promise<ClaimResult> {
  const session = await requireRole("cleaner", "/work/jobs");
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "gone" };
  const { offerId, seriesId } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("claim_series", { p_offer: offerId });
  if (!error) return { ok: true };

  if (error.code === "PC002") {
    // Someone has it. Was it us, on an earlier tap whose reply never arrived?
    const { data: mine } = await supabase
      .from("series")
      .select("id")
      .eq("id", seriesId)
      .eq("cleaner_id", session.userId)
      .maybeSingle();
    if (mine) return { ok: true };
  }
  return claimOutcome(error.code);
}
