"use server";

import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { tidyPhone } from "@/lib/auth/links";
import { makeResetPass, RESET_COOKIE, RESET_COOKIE_OPTIONS, RESET_PASS_MINUTES } from "@/lib/auth/reset-pass";
import { safeNext } from "@/lib/auth/next";
import { postLoginPath } from "@/lib/auth/roles";
import { createClient } from "@/lib/db/server";
import { hasSupabaseEnv, resolveSiteUrl } from "@/lib/env";

const TYPES = new Set<EmailOtpType>(["signup", "email", "recovery"]);

/**
 * Spends an email link, only when the person presses the button on /auth/confirm. A plain
 * GET never does: mail scanners that open links can't burn them, and a page on another
 * site can't sign someone into an account that isn't theirs (login CSRF). Server Actions
 * check the request's Origin against Ping's own host, so this can't be posted cross-site.
 *
 *   token_hash + type   the recommended email templates (work on any device)
 *   code                the default PKCE link (only in the browser that asked for it)
 */
export async function confirmLink(formData: FormData): Promise<void> {
  const field = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && v.length <= 512 ? v : null;
  };
  if (!hasSupabaseEnv()) redirect("/login?link=expired");

  const supabase = await createClient();
  const tokenHash = field("token_hash");
  const type = field("type") as EmailOtpType | null;
  const code = field("code");
  let recovery = type === "recovery";

  if (tokenHash && type && TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) redirect("/login?link=expired");
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) redirect("/login?link=expired");
    recovery = field("flow") === "reset";
  } else {
    redirect("/login?link=expired");
  }

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/login?link=expired");

  if (recovery) {
    const jar = await cookies();
    jar.set(RESET_COOKIE, makeResetPass(user.id), {
      ...RESET_COOKIE_OPTIONS,
      secure: (resolveSiteUrl() ?? "").startsWith("https:"),
      maxAge: RESET_PASS_MINUTES * 60,
    });
    redirect("/reset-password");
  }

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

  redirect(postLoginPath(profile.role, safeNext(field("next"))));
}
