"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";
import { pingErrorMessage } from "@/lib/db/errors";
import { pgUuid } from "../../../_lib/ids";
import { itemChange, PHOTO_PATH } from "../../../_lib/visit";

export type VisitResult = { ok: true } | { ok: false; message: string; code?: string; detail?: string; retry?: boolean };

const NO_SIGNAL: VisitResult = { ok: false, retry: true, message: "That didn't send. Your signal may have dropped: it'll try again." };

/** start_visit(): today's clean, by its cleaner. A retry after it worked is a no-op in the database. */
export async function startVisit(raw: unknown): Promise<VisitResult> {
  await requireRole("cleaner", "/work/today");
  const id = pgUuid.safeParse(raw);
  if (!id.success) return { ok: false, message: pingErrorMessage({ code: "PC010" }) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_visit", { p_visit: id.data });
  if (error) return failure(error);
  revalidatePath("/work/today");
  return { ok: true };
}

/**
 * One checklist item: ticked, or "couldn't do" with a reason, or back to neither.
 * The row policy only lets the visit's cleaner change it while the visit is in progress;
 * the database stamps the times. Ticking sends skipped_reason: null, which clears a reason.
 */
export async function saveItem(raw: unknown): Promise<VisitResult> {
  await requireRole("cleaner", "/work/today");
  const parsed = itemChange.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "That didn't save." };
  const { visitId, itemId, done, reason } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("checklist_items")
    .update({ done, skipped_reason: done ? null : reason || null })
    .eq("id", itemId)
    .eq("visit_id", visitId)
    .select("id");
  if (error) return failure(error);
  if (data?.length !== 1) return { ok: false, message: "This clean isn't in progress any more, so the checklist is closed." };
  return { ok: true };
}

const photoInput = z.object({
  visitId: pgUuid,
  kind: z.enum(["before", "after"]),
  path: z.string().regex(PHOTO_PATH),
  clientTakenAt: z.iso.datetime({ offset: true }).nullable(),
});

/**
 * Records a photo the cleaner has just uploaded straight to the private visit-photos
 * bucket (bucket policy: their visit, in progress). complete_visit() then checks the file
 * really is in the bucket, theirs and not empty. The phone's time is kept for reference only.
 */
export async function recordPhoto(raw: unknown): Promise<VisitResult> {
  const session = await requireRole("cleaner", "/work/today");
  const parsed = photoInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That photo didn't come through properly. Take it again." };
  const { visitId, kind, path, clientTakenAt } = parsed.data;
  if (PHOTO_PATH.exec(path)?.[1] !== visitId) return { ok: false, message: "That photo didn't come through properly. Take it again." };

  const supabase = await createClient();
  const { error } = await supabase.from("visit_photos").insert({
    visit_id: visitId,
    kind,
    storage_path: path,
    client_taken_at: clientTakenAt,
    uploaded_by: session.userId,
  });
  // Same path twice means a retry whose first reply was lost: it's already recorded.
  if (error && error.code !== "23505") return failure(error);
  return { ok: true };
}

/** complete_visit(): the database decides. Already completed is a no-op, so retries are safe. */
export async function completeVisit(raw: unknown): Promise<VisitResult> {
  await requireRole("cleaner", "/work/today");
  const id = pgUuid.safeParse(raw);
  if (!id.success) return { ok: false, message: pingErrorMessage({ code: "PC010" }) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_visit", { p_visit: id.data });
  if (error) return failure(error);
  revalidatePath("/work", "layout");
  return { ok: true };
}

function failure(error: { code?: string; details?: string | null }): VisitResult {
  if (!error.code || error.code.startsWith("08") || error.code === "57014") return NO_SIGNAL;
  return { ok: false, code: error.code, detail: error.details ?? undefined, message: pingErrorMessage(error) };
}
