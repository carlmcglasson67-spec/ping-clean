"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { todayInLondon } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { adminErrorMessage, NOT_SAVED, type ActionResult } from "../_lib/errors";
import { pgUuid } from "../_lib/ids";
import { isOutOfDate, reviewInput } from "./_lib/vetting";

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
