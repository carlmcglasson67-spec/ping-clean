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
  // Same answer whatever happens: account or not, rate-limited or not. Supabase only
  // rate-limits emails to addresses that have an account, so a "too many requests" reply
  // here would tell an attacker the address is registered. (Vercel's firewall limits
  // requests per IP instead: see the PR.)
  await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo: resetReturnUrl() });
  return { sent: parsed.data };
}
