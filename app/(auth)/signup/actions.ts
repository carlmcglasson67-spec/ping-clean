"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { captchaMessage, captchaToken, isCaptchaError } from "@/lib/auth/captcha";
import { unguessablePassword } from "@/lib/auth/consent";
import { emailReturnUrl } from "@/lib/auth/links";
import { safeNext } from "@/lib/auth/next";
import { postLoginPath } from "@/lib/auth/roles";
import { createClient } from "@/lib/db/server";
import { hasSupabaseEnv } from "@/lib/env";

export type SignupState = {
  error?: string;
  fieldErrors?: Partial<Record<"fullName" | "email" | "captcha", string>>;
  values?: { fullName?: string; email?: string };
  /** The confirmation email is on its way (or would be, if the address had no account). */
  sent?: { email: string };
};

const schema = z.object({
  fullName: z.string().trim().min(1, { message: "Tell us your name." }).max(120, { message: "Use 120 characters or fewer." }),
  email: z.email({ message: "Enter an email address, like you@example.com." }).max(254),
  next: z.string().max(512).optional(),
});

export async function signUp(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const raw = {
    fullName: String(formData.get("fullName") ?? ""),
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    next: formData.get("next") ? String(formData.get("next")) : undefined,
  };
  const values = { fullName: raw.fullName.trim(), email: String(formData.get("email") ?? "").trim() };

  // Bots fill every field, including this one, which people never see.
  if (String(formData.get("company") ?? "").length > 0) return { sent: { email: values.email } };

  const parsed = schema.safeParse(raw);
  const fieldErrors: NonNullable<SignupState["fieldErrors"]> = {};
  if (!parsed.success) {
    const fe = z.flattenError(parsed.error).fieldErrors;
    for (const k of ["fullName", "email"] as const) if (fe[k]?.[0]) fieldErrors[k] = fe[k]![0];
  }
  if (!parsed.success || Object.keys(fieldErrors).length) return { values, fieldErrors };

  if (!hasSupabaseEnv()) return { values, error: "Sign-up isn't switched on yet. The Ping team is setting it up." };

  const next = safeNext(parsed.data.next);
  const supabase = await createClient();
  // Nobody chooses their password here. The account starts with a long random one that no
  // one ever sees, and the person picks their own after the email link proves the address
  // is theirs (app/auth/confirm → /reset-password?first=1). Otherwise a stranger could sign
  // up with someone else's address first: Supabase keeps the FIRST password given for an
  // unconfirmed address, so when the real owner later confirmed, the account would still
  // open with the stranger's password (#60). Now there is no password a stranger could know.
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: unguessablePassword(),
    options: {
      captchaToken: captchaToken(formData),
      emailRedirectTo: emailReturnUrl(next),
      // Profile name comes from full_name (private.handle_new_user). The role is never
      // read from here: every new account is a customer. Nothing else is taken here: the
      // phone number and consent to the terms come with the first password, from the person
      // who proved the address (lib/auth/consent.ts). Supabase keeps the FIRST sign-up's
      // details for an unconfirmed address, so these could be a stranger's: the name is
      // shown for checking on that step too.
      data: {
        full_name: parsed.data.fullName,
        // Where to go after confirming (checked again by safeNext then). Cleared on confirm.
        ...(next ? { next } : {}),
        // Cleared when they choose their own (app/(auth)/reset-password/actions.ts).
        password_pending: true,
      },
    },
  });

  if (error) {
    if (isCaptchaError(error)) {
      return formData.has("cf-turnstile-response") ? { values, fieldErrors: { captcha: captchaMessage(formData) } } : { values, error: captchaMessage(formData) };
    }
    // Email-sending limits apply per address, so only to addresses that already exist:
    // answer exactly as for a new address. (The per-IP request limit says nothing about
    // any address, so that one can be shown.)
    if (error.code === "over_email_send_rate_limit") return { sent: { email: parsed.data.email } };
    if (error.code === "over_request_rate_limit") return { values, error: "Too many sign-ups from here just now. Wait a few minutes, then try again." };
    if (error.code === "user_already_exists" || error.code === "email_exists") {
      // Same answer as a new address, so the form can't be used to find out who has an account.
      return { sent: { email: parsed.data.email } };
    }
    return { values, error: "We couldn't create your account just now. Try again in a minute." };
  }

  if (data.session && data.user) {
    // Email confirmation is off (local development only; live keeps it on, go-live step 5):
    // they're signed in already, with no password anyone knows. "Forgotten your password?"
    // sets one. Nothing here proves the address, which is why live must keep confirmation on.
    if (next) await supabase.auth.updateUser({ data: { next: null } });
    redirect(postLoginPath("customer", next));
  }
  return { sent: { email: parsed.data.email } };
}

export type ResendState = { done?: boolean; captcha?: string };

/** "Send it again" on the check-your-email screen. Same reply whatever the address. */
export async function resendConfirmation(_prev: ResendState, formData: FormData): Promise<ResendState> {
  const email = z.email().max(254).safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!email.success || !hasSupabaseEnv()) return { done: true };
  const supabase = await createClient();
  // Same answer whatever happens, rate limits included: Supabase only limits resends for
  // addresses that have an account, so "slow down" would reveal the address is registered.
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: email.data,
    options: {
      emailRedirectTo: emailReturnUrl(safeNext(String(formData.get("next") ?? ""))),
      captchaToken: captchaToken(formData),
    },
  });
  // The human check isn't about the address, so that one refusal can be shown.
  if (isCaptchaError(error)) return { captcha: captchaMessage(formData) };
  return { done: true };
}
