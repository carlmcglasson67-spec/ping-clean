"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";
import { adminErrorMessage, NOT_SAVED } from "../_lib/errors";
import { changes, FIELDS, parseSettings, type SettingKey, type SettingsData } from "./_lib/settings-form";

export type SaveResult =
  | { ok: true; message: string }
  | { ok: false; message: string; errors?: Partial<Record<SettingKey, string>>; stale?: boolean };

const input = z.object({
  values: z.record(z.string(), z.string().max(600)),
  expectedUpdatedAt: z.string().min(10).max(40),
});

const STALE = "Someone on the team changed the settings while you were editing. Your changes aren't saved: reload, check theirs, then make yours again.";

/**
 * Saves the settings the admin reviewed. Everything is parsed again here (the browser is
 * never trusted), only the fields that changed are written, and only if the row is exactly
 * as the admin saw it (updated_at), so one person can't silently overwrite another.
 * The settings audit trigger logs each change, old and new, with the admin as the actor.
 */
export async function saveSettings(raw: unknown): Promise<SaveResult> {
  await requireRole("admin", "/admin/settings");
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: NOT_SAVED };

  const values = Object.fromEntries(FIELDS.map((f) => [f.key, parsed.data.values[f.key] ?? ""]));
  const next = parseSettings(values);
  if (!next.ok) return { ok: false, message: "Some of those need fixing first.", errors: next.errors };

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase.from("settings").select("*").maybeSingle();
  if (readError || !current) return { ok: false, message: adminErrorMessage(readError) };
  if (current.updated_at !== parsed.data.expectedUpdatedAt) return { ok: false, message: STALE, stale: true };

  const diff = changes(current, next.data);
  if (diff.length === 0) return { ok: true, message: "Nothing had changed, so nothing was saved." };
  const patch = Object.fromEntries(diff.map((c) => [c.key, next.data[c.key]])) as Partial<SettingsData>;

  // Compare-and-set: each changed field must still hold the value the admin saw, so a save
  // racing another one between the read above and this write changes nothing.
  let write = supabase.from("settings").update(patch).eq("id", true);
  for (const c of diff) {
    const old = current[c.key];
    if (Array.isArray(old)) continue; // the district list: covered by the updated_at check above
    write = old === null ? write.filter(c.key, "is", null) : write.filter(c.key, "eq", String(old));
  }
  const { data, error } = await write.select("updated_at");
  if (error) return { ok: false, message: adminErrorMessage(error) };
  if (!data?.length) return { ok: false, message: STALE, stale: true };

  revalidatePath("/admin", "layout");
  return { ok: true, message: diff.length === 1 ? "Saved. 1 setting changed." : `Saved. ${diff.length} settings changed.` };
}
