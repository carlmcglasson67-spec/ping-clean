"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";
import { adminErrorMessage, NOT_SAVED, type ActionResult } from "../_lib/errors";
import { pgUuid } from "../_lib/ids";

// The interest list is reached only through its admin functions (no table access at all);
// each one checks the caller is an admin and leaves an audit line without contact details.

export async function markTold(raw: unknown): Promise<ActionResult> {
  await requireRole("admin", "/admin/interest");
  const p = z.object({ ids: z.array(pgUuid).min(1, "Tick at least one person first.").max(5000), told: z.boolean() }).safeParse(raw);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? NOT_SAVED };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_mark_interest_notified", { p_ids: p.data.ids, p_notified: p.data.told });
  if (error) return { ok: false, message: adminErrorMessage(error) };
  revalidatePath("/admin/interest");
  const n = typeof data === "number" ? data : 0;
  const who = `${n} ${n === 1 ? "person" : "people"}`;
  return { ok: true, message: p.data.told ? `Marked ${who} as told.` : `${who} back to "not told yet".` };
}

/**
 * Delete on request (issue #21 item 5). It can't be undone, and the console only ever sees
 * masked contacts, so the admin must say how the request arrived and confirm the sender
 * matches this entry's contact. Shared request C-2 would let them type the address instead.
 */
export async function deleteInterest(raw: unknown): Promise<ActionResult> {
  await requireRole("admin", "/admin/interest");
  const p = z
    .object({
      id: pgUuid,
      arrivedBy: z.enum(["email", "phone"], { message: "Say how the request arrived." }),
      senderMatches: z.literal(true, { message: "Confirm the request came from this contact." }),
    })
    .safeParse(raw);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? NOT_SAVED };

  // The entry's contact type comes from the database, never from the browser. The only
  // admin read of the list is admin_list_interest (masked, audited as a list view); C-2's
  // admin_find_interest is the proper, exact lookup once it lands.
  const supabase = await createClient();
  const { data: list, error: readError } = await supabase.rpc("admin_list_interest", { p_district: null });
  if (readError) return { ok: false, message: adminErrorMessage(readError) };
  const entry = (list ?? []).find((r) => r.id === p.data.id);
  if (!entry) return { ok: false, message: "That entry has already gone (deleted, or past its retention date)." };
  if (p.data.arrivedBy !== entry.contact_type) {
    return {
      ok: false,
      message: entry.contact_type === "email"
        ? "This entry is an email address. A request by text can't prove it's theirs: ask them to email from that address."
        : "This entry is a mobile number. A request by email can't prove it's theirs: ask them to text from that number.",
    };
  }
  const { data, error } = await supabase.rpc("admin_delete_interest", { p_ids: [p.data.id] });
  if (error) return { ok: false, message: adminErrorMessage(error) };
  if (data !== 1) return { ok: false, message: "That entry has already gone (deleted, or past its retention date)." };
  revalidatePath("/admin/interest");
  return { ok: true, message: "Deleted. It can't be brought back." };
}
