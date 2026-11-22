"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";
import { adminErrorMessage, NOT_SAVED, type ActionResult } from "../_lib/errors";

const input = z.object({
  email: z.string().trim().min(3).max(254),
  make: z.boolean(),
  reason: z.string().max(300),
});

/**
 * Adds or removes an admin. Everything is decided in the database
 * (public.admin_set_admin: only admins, confirmed accounts, never yourself, never the last
 * one), which also logs it with your name and the reason.
 */
export async function setAdmin(raw: unknown): Promise<ActionResult> {
  await requireRole("admin", "/admin/team");
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: NOT_SAVED };
  const { email, make, reason } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_set_admin", { p_email: email, p_make: make, p_reason: reason });
  if (error) return { ok: false, message: adminErrorMessage(error) };
  const who = data?.[0]?.full_name?.trim() || email;
  revalidatePath("/admin/team");
  return {
    ok: true,
    message: make
      ? `${who} is now an admin. They'll see the console next time they open Ping.`
      : `${who} is no longer an admin. Their account is a customer one again.`,
  };
}
