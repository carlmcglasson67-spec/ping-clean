"use server";

import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { parseConfirmForm } from "@/lib/auth/confirm-fields";
import { tidyPhone } from "@/lib/auth/links";
import { safeNext } from "@/lib/auth/next";
import { makeResetPass, RESET_COOKIE, RESET_COOKIE_OPTIONS, RESET_PASS_MINUTES, resetPassSecret } from "@/lib/auth/recovery";
import { postLoginPath } from "@/lib/auth/roles";
import { createClient } from "@/lib/db/server";
import { hasSupabaseEnv, resolveSiteUrl } from "@/lib/env";

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

  // A reset link: give THIS session a signed 15-minute reset pass (lib/auth/recovery.ts).
  // Only here, after a recovery link verified: a sign-up confirmation never gets one.
  if (recovery) {
    const secret = resetPassSecret();
    const { data: claims } = await supabase.auth.getClaims();
    const sessionId = claims?.claims?.session_id;
    if (!secret) console.error("RESET_PASS_SECRET is not set: password resets are switched off.");
    if (secret && typeof sessionId === "string") {
      const jar = await cookies();
      jar.set(RESET_COOKIE, makeResetPass(sessionId, secret), {
        ...RESET_COOKIE_OPTIONS,
        secure: (resolveSiteUrl() ?? "").startsWith("https:"),
        maxAge: RESET_PASS_MINUTES * 60,
      });
    }
    redirect("/reset-password"); // without a pass, it says the link has run out
  }

  const { data: profile } = await supabase.from("profiles").select("role, phone").eq("id", user.id).maybeSingle();
  if (!profile) redirect("/login?link=expired");

  // The phone number given at sign-up waits in the account's metadata until now (there was
  // no session to save it with). Copy it once, only if the profile has none, then remove it
  // from the metadata so it lives in one place, under the profile's rules.
  // Where they were going ("next") waits there too: the email link is built from the Site
  // URL alone (see the PR's template steps), so it can't carry it. Both are cleared.
  const meta = user.user_metadata ?? {};
  const metaPhone = meta.phone;
  if (typeof metaPhone === "string") {
    const phone = tidyPhone(metaPhone);
    if (phone && phone !== "invalid" && !profile.phone) {
      await supabase.from("profiles").update({ phone }).eq("id", user.id);
    }
  }
  if (meta.phone != null || meta.next != null) await supabase.auth.updateUser({ data: { phone: null, next: null } });

  const next = f.next ?? (typeof meta.next === "string" ? meta.next : undefined);
  const to = postLoginPath(profile.role, safeNext(next));
  redirect(`/auth/confirmed?next=${encodeURIComponent(to)}` as "/auth/confirmed");
}
