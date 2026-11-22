"use server";

import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { parseConfirmForm } from "@/lib/auth/confirm-fields";
import { unguessablePassword } from "@/lib/auth/consent";
import { tidyPhone } from "@/lib/auth/links";
import { safeNext } from "@/lib/auth/next";
import { makeResetPass, RESET_COOKIE, RESET_COOKIE_OPTIONS, RESET_PASS_MINUTES, RESET_SECRET_PROBLEM, resetPassSecret } from "@/lib/auth/recovery";
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
  // An invite link, only once a token-hash link has verified as one. A code (PKCE) link
  // never counts, whatever the form says (confirm-fields.ts refuses code + type anyway).
  let invite = false;
  if (f.token_hash && f.type) {
    const { data: verified, error } = await supabase.auth.verifyOtp({ token_hash: f.token_hash, type: f.type as EmailOtpType });
    if (error) redirect("/login?link=expired");
    if (halfEmailChange(f.type, verified.session)) redirect("/auth/other-address");
    invite = f.type === "invite";
  } else {
    const { error } = await supabase.auth.exchangeCodeForSession(f.code!);
    if (error) redirect("/login?link=expired");
    recovery = f.flow === "reset";
  }

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/login?link=expired");

  // A reset link: give THIS session a signed 15-minute reset pass (lib/auth/recovery.ts).
  if (recovery) {
    await giveResetPass(supabase);
    redirect("/reset-password"); // without a pass, it says the link has run out
  }

  const { data: profile } = await supabase.from("profiles").select("role, phone").eq("id", user.id).maybeSingle();
  if (!profile) redirect("/login?link=expired");

  // A sign-up confirmation: whoever filled in the form, this person has just proved the
  // address is theirs. Replace the password at once with one nobody knows, whatever the
  // account holds (an account made before #60 could still hold a stranger's), and have
  // them choose their own next. Decided by the link, not by metadata a user could edit.
  // An invite is handled exactly the same (issue #21, note 3): GoTrue finds sign-up and
  // invite links by the same token, so either type verifies either link, and re-inviting
  // an unconfirmed account keeps whatever password it already has.
  // GoTrue also verifies these links under type=email. An invite link has no flow=signup to
  // catch that, so an invited account that has never been through this step counts too:
  // password_pending is absent until this step sets it, and null once they choose.
  const untouchedInvite = Boolean(user.invited_at) && !("password_pending" in (user.user_metadata ?? {}));
  const signupLink = f.flow === "signup" || f.type === "signup" || invite || (Boolean(f.token_hash) && untouchedInvite);
  if (signupLink) {
    const { error } = await supabase.auth.updateUser({ password: unguessablePassword(), data: { password_pending: true } });
    if (error) redirect("/login?link=expired");
  }

  // The phone number given at sign-up waits in the account's metadata until now (there was
  // no session to save it with). Copy it once, only if the profile has none, then remove it
  // from the metadata so it lives in one place, under the profile's rules.
  // Where they were going ("next") waits there too: the email link is built from the Site
  // URL alone (see the PR's template steps), so it can't carry it. Both are cleared.
  const meta = user.user_metadata ?? {};
  const first = signupLink || meta.password_pending === true;
  const metaPhone = meta.phone;
  // A new account's phone comes from the owner on the next step, never from the sign-up
  // form, which a stranger may have filled in first (#60).
  if (typeof metaPhone === "string" && !first) {
    const phone = tidyPhone(metaPhone);
    if (phone && phone !== "invalid" && !profile.phone) {
      await supabase.from("profiles").update({ phone }).eq("id", user.id);
    }
  }
  if (meta.phone != null || meta.next != null) await supabase.auth.updateUser({ data: { phone: null, next: null } });

  const next = f.next ?? (typeof meta.next === "string" ? meta.next : undefined);
  const to = postLoginPath(profile.role, safeNext(next));

  // A new account has no password anyone knows (signup/actions.ts, #60): this person has
  // just proved the address is theirs, so they choose it now, with the same pass a reset
  // link gives. The link was the proof, so this is the only place that pass is handed out
  // for a sign-up, and only while the account is still waiting for its first password.
  if (first) await giveResetPass(supabase);
  const kind = f.type === "email_change" ? "kind=email_change&" : ""; // issue #21, note 1
  // Invited or not is read from the account (GoTrue sets invited_at), never from the link
  // type, which can be swapped. It only changes words on the next pages.
  const invited = first && Boolean(user.invited_at) ? "invited=1&" : "";
  redirect(`/auth/confirmed?${first ? "first=1&" : ""}${invited}${kind}next=${encodeURIComponent(to)}` as "/auth/confirmed");
}

/** A signed 15-minute pass for THIS session to choose a password (lib/auth/recovery.ts). */
async function giveResetPass(supabase: Awaited<ReturnType<typeof createClient>>): Promise<void> {
  const secret = resetPassSecret();
  const { data: claims } = await supabase.auth.getClaims();
  const sessionId = claims?.claims?.session_id;
  if (!secret) console.error(RESET_SECRET_PROBLEM);
  if (secret && typeof sessionId === "string") {
    const jar = await cookies();
    jar.set(RESET_COOKIE, makeResetPass(sessionId, secret), {
      ...RESET_COOKIE_OPTIONS,
      secure: (resolveSiteUrl() ?? "").startsWith("https:"),
      maxAge: RESET_PASS_MINUTES * 60,
    });
  }
}

/**
 * Secure email change (issue #21, note 1): changing an address sends a link to each
 * address, and the first one used gives no session (GoTrue: "Confirmation link accepted.
 * Please proceed to confirm link sent to the other email"). Checked before anything looks
 * at who is signed in, so a browser already signed in doesn't carry on as if it were done.
 */
function halfEmailChange(type: string, session: unknown): boolean {
  return type === "email_change" && !session;
}
