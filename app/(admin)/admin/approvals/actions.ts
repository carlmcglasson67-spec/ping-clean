"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { todayInLondon } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { adminErrorMessage, NOT_SAVED, type ActionResult } from "../_lib/errors";
import { pgUuid } from "../_lib/ids";
import { DOCUMENT_KIND } from "@/lib/labels";
import { decisionInput, isOutOfDate, reviewInput, waitingKinds } from "./_lib/vetting";

/**
 * Verify a document, or send it back with a reason the cleaner will read.
 *
 * Goes through the existing admin review grant and policy (documents_admin_review): the
 * database checks the caller is an admin and that reviewed_by is them, and the row's audit
 * trigger logs the change with the reason redacted. Only moves a document from the status
 * the admin was looking at, so two of the team acting at once can't overwrite each other.
 */
export async function reviewDocument(raw: unknown): Promise<ActionResult> {
  const session = await requireRole("admin", "/admin/approvals");
  const parsed = reviewInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? NOT_SAVED };
  const id = pgUuid.safeParse(parsed.data.documentId);
  if (!id.success) return { ok: false, message: "That document wasn't found." };

  const input = parsed.data;
  const supabase = await createClient();
  const today = todayInLondon();

  // Never verify a document that's out of date: checked here on the server against the
  // stored date, and again in the write itself (the expiry must still be what we read).
  let expiresOn: string | null = null;
  if (input.decision === "verify") {
    const { data: doc, error: readError } = await supabase.from("cleaner_documents").select("expires_on").eq("id", id.data).maybeSingle();
    if (readError) return { ok: false, message: adminErrorMessage(readError) };
    if (!doc) return { ok: false, message: "That document wasn't found." };
    if (isOutOfDate(doc.expires_on, today)) {
      return { ok: false, message: "This document is out of date, so it can't be verified. Send it back and ask the cleaner for a current one." };
    }
    expiresOn = doc.expires_on;
  }

  let write = supabase
    .from("cleaner_documents")
    .update({
      status: input.decision === "verify" ? "verified" : "rejected",
      reviewed_by: session.userId,
      reviewed_at: new Date().toISOString(),
      rejection_reason: input.decision === "reject" ? input.reason : null,
    })
    .eq("id", id.data)
    .eq("status", input.expected);
  if (input.decision === "verify") write = expiresOn ? write.eq("expires_on", expiresOn).gt("expires_on", today) : write.is("expires_on", null);
  const { data, error } = await write.select("cleaner_id");

  if (error) return { ok: false, message: adminErrorMessage(error) };
  if (!data?.length) return { ok: false, message: "Someone on the team has just reviewed that document. Refresh to see where it stands." };
  revalidatePath("/admin/approvals", "layout");
  return { ok: true, message: input.decision === "verify" ? "Verified." : "Sent back. The cleaner will see your reason." };
}

const DONE = {
  approve: "Approved. They can see and take jobs now.",
  decline: "Declined. They've been told nothing by Ping: let them know yourself.",
  suspend: "Suspended. They can't see jobs or addresses any more. Check the jobs page for their blocks.",
  reactivate: "Back on. They can see and take jobs again.",
  tier: "Tier changed.",
} as const;

/**
 * Approve, decline, suspend, reactivate or change tier. The database makes the decision
 * (admin_review_cleaner / admin_set_cleaner_tier): it checks the caller is an admin, that
 * the four checks are verified and in date, and that the move fits where the cleaner
 * stands, then logs who decided and why. Nothing here is trusted from the browser but the
 * choice itself.
 */
export async function decideCleaner(raw: unknown): Promise<ActionResult> {
  await requireRole("admin", "/admin/approvals");
  const parsed = decisionInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? NOT_SAVED };
  const id = pgUuid.safeParse(parsed.data.cleanerId);
  if (!id.success) return { ok: false, message: "That cleaner wasn't found." };

  const input = parsed.data;
  const supabase = await createClient();
  const { error } =
    input.decision === "tier"
      ? await supabase.rpc("admin_set_cleaner_tier", { p_cleaner: id.data, p_tier: input.tier, p_reason: input.reason })
      : await supabase.rpc("admin_review_cleaner", {
          p_cleaner: id.data,
          p_decision: input.decision,
          p_tier: input.decision === "approve" ? input.tier : null,
          p_reason: ("reason" in input ? input.reason : input.note) || null,
        });

  if (error) {
    if (error.code === "PC052") {
      const kinds = waitingKinds(error.details).map((k) => DOCUMENT_KIND[k]);
      return { ok: false, message: kinds.length ? `Not yet: still waiting on ${kinds.join(", ")}. Each needs a verified, in-date document.` : adminErrorMessage(error) };
    }
    return { ok: false, message: adminErrorMessage(error) };
  }
  revalidatePath("/admin/approvals", "layout");
  return { ok: true, message: DONE[input.decision] };
}
