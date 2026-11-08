import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Who may choose a new password: only the session that a reset link created, for 15 minutes.
 *
 * Why two checks (PR #19 final check, F1):
 *  - The session's `amr` claim can't tell a reset from a sign-up confirmation. GoTrue's
 *    POST /verify (supabase.auth.verifyOtp with a token hash) issues every session with
 *    method "otp", whatever the link type (gotrue internal/api/verify.go, verifyPost:
 *    `a.issueRefreshToken(…, models.OTP, …)`). A default PKCE reset link gives "recovery".
 *  - So the confirm action, only when a RECOVERY link verifies, also sets a reset pass: an
 *    httpOnly cookie holding that session's id and an expiry, HMAC-SHA256 signed with the
 *    server-only RESET_PASS_SECRET. It can't be forged in the browser, and it only works
 *    for the session it was made for.
 *
 * The page and its action need both: a valid pass for the current session_id, and an amr
 * entry of "otp" or "recovery" from the last 15 minutes. A normal sign-in has neither; a
 * sign-up confirmation has "otp" but no pass.
 */
export const RESET_COOKIE = "ping-reset";
export const RESET_PASS_MINUTES = 15;
export const RESET_COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax", path: "/reset-password" } as const;
const LINK_METHODS = new Set(["otp", "recovery"]);

type Env = Record<string, string | undefined>;

// Outside production a missing secret falls back to one made per server start, so local
// development works; reset passes then stop working on restart, which is harmless.
let devSecret: string | undefined;

export const RESET_SECRET_PROBLEM = "RESET_PASS_SECRET is missing or shorter than 32 characters: password resets are switched off.";

/**
 * The signing secret. Required in production (at least 32 characters): null there when it's
 * missing or shorter than 32 characters, and every reset then fails closed. Also checked
 * when the server starts (instrumentation.ts), so a bad setup shows in the logs at once.
 */
export function resetPassSecret(env: Env = process.env): string | null {
  const s = env.RESET_PASS_SECRET;
  if (s && s.length >= 32) return s;
  if (env.NODE_ENV === "production") return null;
  devSecret ??= randomBytes(32).toString("hex");
  return devSecret;
}

const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

/** `<session id>.<expiry ms>.<signature>` */
export function makeResetPass(sessionId: string, secret: string, now = Date.now()): string {
  const payload = `${sessionId}.${now + RESET_PASS_MINUTES * 60_000}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** A pass signed with this secret, for exactly this session, not expired. */
export function resetPassValid(value: string | undefined, sessionId: string | undefined, secret: string | null, now = Date.now()): boolean {
  if (!value || !sessionId || !secret || value.length > 300) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [sid, exp, sig] = parts as [string, string, string];
  const want = Buffer.from(sign(`${sid}.${exp}`, secret));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
  const expires = Number(exp);
  return sid === sessionId && Number.isFinite(expires) && expires > now && expires <= now + RESET_PASS_MINUTES * 60_000;
}

export type AmrEntry = { method: string; timestamp: number };

/** The amr claim, tidied: entries with a method and a timestamp in seconds. Anything else is dropped. */
export function amrEntries(amr: unknown): AmrEntry[] {
  if (!Array.isArray(amr)) return [];
  return amr.flatMap((e) =>
    e && typeof e === "object" && typeof (e as AmrEntry).method === "string" && Number.isFinite((e as AmrEntry).timestamp)
      ? [{ method: (e as AmrEntry).method, timestamp: (e as AmrEntry).timestamp }]
      : [],
  );
}

/** An email link ("otp", or "recovery" for PKCE) was used in the last 15 minutes. */
export function freshEmailLink(amr: unknown, now = Date.now()): boolean {
  const oldest = now - RESET_PASS_MINUTES * 60_000;
  return amrEntries(amr).some(
    (e) => LINK_METHODS.has(e.method) && e.timestamp * 1000 >= oldest && e.timestamp * 1000 <= now + 60_000, // a minute's clock skew
  );
}

/** Both checks, for the new-password page and its action. */
export function canChooseNewPassword(
  pass: string | undefined,
  session: { sessionId: string | null; amr: AmrEntry[] } | null,
  secret: string | null,
  now = Date.now(),
): boolean {
  return Boolean(session?.sessionId) && resetPassValid(pass, session!.sessionId!, secret, now) && freshEmailLink(session!.amr, now);
}
