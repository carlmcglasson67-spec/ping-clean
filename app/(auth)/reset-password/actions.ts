"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/auth/consent";
import { tidyPhone } from "@/lib/auth/links";
import { canChooseNewPassword, RESET_COOKIE, RESET_COOKIE_OPTIONS, resetPassSecret } from "@/lib/auth/recovery";
import { passwordProblem } from "@/lib/auth/password";
import { safeNext } from "@/lib/auth/next";
import { postLoginPath } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";

export type FirstField = "password" | "fullName" | "phone" | "terms" | "privacy";
export type ResetState = { error?: string; fieldError?: string; fieldErrors?: Partial<Record<FirstField, string>> };

export async function setNewPassword(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const [session, jar] = await Promise.all([getSession(), cookies()]);
  // Checked again here, not just on the page: a signed reset pass for THIS session, and an
  // email link used in the last 15 minutes.
  if (!session || !canChooseNewPassword(jar.get(RESET_COOKIE)?.value, session, resetPassSecret())) {
    return { error: "That link has run out. Ask for a new one and use it within 15 minutes." };
  }
  const password = String(formData.get("password") ?? "");
  const problem = passwordProblem(password, session.email ?? "");

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  // A new account (signup/actions.ts, #60): its name, phone and consent are taken here, from
  // the person who has just proved the address, not from the sign-up form, which anyone
  // could have filled in first. Decided by the account, never by the form.
  const first = userData.user?.user_metadata?.password_pending === true;

  if (!first) {
    if (problem) return { fieldError: problem };
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return failure(error);
    jar.delete({ name: RESET_COOKIE, path: RESET_COOKIE_OPTIONS.path }); // used: gone
    redirect(postLoginPath(session.role, null));
  }

  const fullName = String(formData.get("fullName") ?? "").trim();
  const phoneRaw = String(formData.get("phone") ?? "");
  const errors: NonNullable<ResetState["fieldErrors"]> = {};
  if (problem) errors.password = problem;
  if (!fullName) errors.fullName = "Tell us your name.";
  else if (fullName.length > 120) errors.fullName = "Use 120 characters or fewer.";
  const phone = phoneRaw.length > 40 ? "invalid" : tidyPhone(phoneRaw);
  if (phone === "invalid") errors.phone = "That doesn't look like a phone number. Leave it blank if you'd rather.";
  if (formData.get("terms") !== "on") errors.terms = "Tick to agree to the terms of use.";
  if (formData.get("privacy") !== "on") errors.privacy = "Tick to say you've read the privacy notice.";
  if (Object.keys(errors).length) return { fieldErrors: errors };

  const { error } = await supabase.auth.updateUser({
    password,
    data: {
      password_pending: null,
      full_name: fullName,
      terms_version: TERMS_VERSION,
      privacy_version: PRIVACY_VERSION,
      consented_at: new Date().toISOString(),
      phone: null,
      next: null,
    },
  });
  if (error) {
    const f = failure(error);
    return f.fieldError ? { fieldErrors: { password: f.fieldError } } : f;
  }
  // Their own row, under its own rules (profiles_update_self: name and phone only).
  await supabase.from("profiles").update({ full_name: fullName, phone: phone ?? null }).eq("id", session.userId);
  jar.delete({ name: RESET_COOKIE, path: RESET_COOKIE_OPTIONS.path }); // used: gone
  // Carries on where it was going (checked again: only paths in its own area).
  redirect(postLoginPath(session.role, safeNext(String(formData.get("next") ?? ""))));
}

function failure(error: { code?: string; status?: number }): ResetState {
  if (error.code === "same_password") return { fieldError: "That's the password you already have. Choose a new one." };
  if (error.code === "weak_password") return { fieldError: "That password is too easy to guess. Try a longer one." };
  if (error.status === 429) return { error: "Too many attempts. Wait a minute, then try again." };
  return { error: "We couldn't save your password just now. Try again in a minute." };
}
