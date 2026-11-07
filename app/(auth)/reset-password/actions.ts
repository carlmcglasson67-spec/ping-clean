"use server";

import { redirect } from "next/navigation";
import { freshRecovery } from "@/lib/auth/recovery";
import { passwordProblem } from "@/lib/auth/password";
import { homeFor } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";

export type ResetState = { error?: string; fieldError?: string };

export async function setNewPassword(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const session = await getSession();
  // Checked again here, not just on the page: the signed token must show a reset link used
  // in the last 15 minutes. Nothing the browser holds can fake that.
  if (!session || !freshRecovery(session.amr)) {
    return { error: "That reset link has run out. Ask for a new one and use it within 15 minutes." };
  }
  const password = String(formData.get("password") ?? "");
  const problem = passwordProblem(password, session.email ?? "");
  if (problem) return { fieldError: problem };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password") return { fieldError: "That's the password you already have. Choose a new one." };
    if (error.code === "weak_password") return { fieldError: "That password is too easy to guess. Try a longer one." };
    if (error.status === 429) return { error: "Too many attempts. Wait a minute, then try again." };
    return { error: "We couldn't change your password just now. Try again in a minute." };
  }
  redirect(homeFor(session.role));
}
