"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";
import { adminErrorMessage, NOT_SAVED, type ActionResult } from "../_lib/errors";
import { pgUuid } from "../_lib/ids";

const input = z.object({
  visitId: pgUuid,
  score: z.coerce.number().int().min(1, "Choose a score from 1 to 10.").max(10, "Choose a score from 1 to 10."),
  notes: z.string().trim().max(1000, "Keep notes to 1,000 characters.").optional(),
});

/**
 * Scores a finished clean, once. Goes through the existing visit_qc admin policy (admins
 * only, reviewed_by must be the admin), and the visit_qc audit trigger logs it with the
 * notes redacted. The cleaner sees their own scores; customers never do.
 */
export async function scoreVisit(raw: unknown): Promise<ActionResult> {
  const session = await requireRole("admin", "/admin/qc");
  const p = input.safeParse(raw);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? NOT_SAVED };

  const supabase = await createClient();
  const { data: visit, error: readError } = await supabase.from("visits").select("status").eq("id", p.data.visitId).maybeSingle();
  if (readError) return { ok: false, message: adminErrorMessage(readError) };
  if (visit?.status !== "completed") return { ok: false, message: "Only a finished clean can be scored." };

  const { error } = await supabase.from("visit_qc").insert({
    visit_id: p.data.visitId,
    score: p.data.score,
    notes: p.data.notes || null,
    reviewed_by: session.userId,
  });
  if (error?.code === "23505") return { ok: false, message: "Someone on the team has already scored this clean." };
  if (error) return { ok: false, message: adminErrorMessage(error) };
  revalidatePath("/admin", "layout");
  return { ok: true, message: `Scored ${p.data.score} out of 10.` };
}
