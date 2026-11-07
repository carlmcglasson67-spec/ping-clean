"use server";

import { z } from "zod";
import { resetReturnUrl } from "@/lib/auth/links";
import { createClient } from "@/lib/db/server";
import { hasSupabaseEnv } from "@/lib/env";

export type ForgotState = { sent?: string; error?: string; email?: string };

export async function requestReset(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const email = String(formData.get("email") ?? "").trim();
  const parsed = z.email().max(254).safeParse(email.toLowerCase());
  if (!parsed.success) return { email, error: "Enter the email address you use for Ping." };
  if (!hasSupabaseEnv()) return { email, error: "Password reset isn't switched on yet. The Ping team is setting it up." };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo: resetReturnUrl() });
  if (error?.status === 429) return { email, error: "Too many requests just now. Wait a few minutes, then try again." };
  // Same answer whether or not there's an account for this address (and on any other
  // error), so the page can't be used to find out who uses Ping.
  return { sent: parsed.data };
}
