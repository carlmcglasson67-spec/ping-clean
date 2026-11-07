import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { RESET_COOKIE, siteUrl, tidyPhone } from "@/lib/auth/links";
import { safeNext } from "@/lib/auth/next";
import { postLoginPath } from "@/lib/auth/roles";
import { createClient } from "@/lib/db/server";
import { hasSupabaseEnv } from "@/lib/env";

const TYPES = new Set<EmailOtpType>(["signup", "email", "recovery", "invite", "email_change", "magiclink"]);

/**
 * Where every Supabase email link lands: confirming a new account, and resetting a password.
 *
 *   ?token_hash=…&type=…   the recommended email templates (work on any device)
 *   ?code=…                 the default PKCE link (only works in the browser that signed up)
 *
 * On success there is a session. A reset goes on to choose a new password; a new account
 * goes to ?next= (checked against the allowlist) or its home. Any failure (expired, used
 * twice, tampered) goes to sign-in with a plain message, never the raw error.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  // Redirects go to the configured site (lib/auth/links.ts siteUrl), so the session cookie
  // set here follows the person.
  const origin = siteUrl("/", request).origin;
  const fail = () => NextResponse.redirect(new URL("/login?link=expired", origin));
  if (!hasSupabaseEnv()) return fail();

  const supabase = await createClient();
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const code = params.get("code");
  let recovery = type === "recovery";

  if (tokenHash && type && TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return fail();
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail();
    recovery = params.get("flow") === "reset";
  } else {
    return fail();
  }

  if (recovery) {
    // The new-password page only works for 15 minutes after a real reset link, so a phone
    // left signed in can't have its password changed without access to the email.
    const res = NextResponse.redirect(new URL("/reset-password", origin));
    res.cookies.set(RESET_COOKIE, "1", { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https:"), path: "/reset-password", maxAge: 15 * 60 });
    return res;
  }

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return fail();
  const { data: profile } = await supabase.from("profiles").select("role, phone").eq("id", user.id).maybeSingle();
  if (!profile) return fail();

  // The phone number given at sign-up waits in the account's metadata until now (there was
  // no session to save it with). Copy it once, only if the profile has none.
  const phone = typeof user.user_metadata?.phone === "string" ? tidyPhone(user.user_metadata.phone) : null;
  if (phone && phone !== "invalid" && !profile.phone) {
    await supabase.from("profiles").update({ phone }).eq("id", user.id);
  }

  return NextResponse.redirect(new URL(postLoginPath(profile.role, safeNext(params.get("next"))), origin));
}
