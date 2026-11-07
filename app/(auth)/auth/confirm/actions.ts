"use server";

import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { parseConfirmForm } from "@/lib/auth/confirm-fields";
import { tidyPhone } from "@/lib/auth/links";
import { safeNext } from "@/lib/auth/next";
import { postLoginPath } from "@/lib/auth/roles";
import { createClient } from "@/lib/db/server";
import { hasSupabaseEnv } from "@/lib/env";

/**
 * Spends an email link, only when the person presses the button on /auth/confirm. A plain
 * GET never does: mail scanners that open links can't burn them, and a page on another
 * site can't sign someone into an account that isn't theirs (login CSRF). Server Actions
 * check the request's Origin against Ping's own host, so this can't be posted cross-site.
 * Afterwards /auth/confirmed shows which account is now signed in (re-review N6).
 */
export async function confirmLink(formData: FormData): Promise<void> {
  if (!hasSupabaseEnv()) redirect("/login?link=expired");
  const parsed = parseConfirmForm(formData);
  if (!parsed.success) redirect("/login?link=expired");
  const f = parsed.data;

  const supabase = await createClient();
  let recovery = f.type === "recovery";
  if (f.token_hash && f.type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: f.token_hash, type: f.type as EmailOtpType });
    if (error) redirect("/login?link=expired");
  } else {
    const { error } = await supabase.auth.exchangeCodeForSession(f.code!);
    if (error) redirect("/login?link=expired");
    recovery = f.flow === "reset";
  }

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/login?link=expired");

  // The new-password page checks the session itself (a reset link used in the last
  // 15 minutes, from the signed token), so nothing needs to be carried over.
  if (recovery) redirect("/reset-password");

  const { data: profile } = await supabase.from("profiles").select("role, phone").eq("id", user.id).maybeSingle();
  if (!profile) redirect("/login?link=expired");

  // The phone number given at sign-up waits in the account's metadata until now (there was
  // no session to save it with). Copy it once, only if the profile has none, then remove it
  // from the metadata so it lives in one place, under the profile's rules.
  const metaPhone = user.user_metadata?.phone;
  if (typeof metaPhone === "string") {
    const phone = tidyPhone(metaPhone);
    if (phone && phone !== "invalid" && !profile.phone) {
      await supabase.from("profiles").update({ phone }).eq("id", user.id);
    }
    await supabase.auth.updateUser({ data: { phone: null } });
  }

  const to = postLoginPath(profile.role, safeNext(f.next));
  redirect(`/auth/confirmed?next=${encodeURIComponent(to)}` as "/auth/confirmed");
}
