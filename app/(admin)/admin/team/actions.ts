"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";
import { adminErrorMessage, NOT_SAVED, type ActionResult } from "../_lib/errors";

const input = z.discriminatedUnion("make", [
  z.object({ make: z.literal(true), email: z.string().trim().max(254), reason: z.string().max(300) }),
  z.object({ make: z.literal(false), profileId: z.uuid(), reason: z.string().max(300) }),
]);

/**
 * Adds an admin by email, or removes one by id. Everything is decided in the database
 * (admin_add_admin / admin_remove_admin: only admins, confirmed customer accounts, never
 * yourself, never the last one), which also records it with your name and the reason.
 */
export async function setAdmin(raw: unknown): Promise<ActionResult> {
  await requireRole("admin", "/admin/team");
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: NOT_SAVED };
  const v = parsed.data;

  const supabase = await createClient();
  const { data, error } = v.make
    ? await supabase.rpc("admin_add_admin", { p_email: v.email, p_reason: v.reason })
    : await supabase.rpc("admin_remove_admin", { p_profile: v.profileId, p_reason: v.reason });
  if (error) return { ok: false, message: adminErrorMessage(error) };
  const who = data?.[0]?.full_name?.trim() || data?.[0]?.email || "They";
  revalidatePath("/admin/team");
  return {
    ok: true,
    message: v.make
      ? `${who} is now an admin. They'll see the console next time they open Ping.`
      : `${who} is no longer an admin. Their account is a customer one again.`,
  };
}
