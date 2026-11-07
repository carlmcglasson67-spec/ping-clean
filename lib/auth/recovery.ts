/**
 * Who may choose a new password: only someone whose session came from a reset link (or a
 * one-time code) within the last 15 minutes. Read from the session's `amr` claim, which
 * Supabase writes into the signed access token: it can't be edited in the browser, unlike
 * a cookie (PR #19 re-review N1). A phone left signed in with a password session can't
 * reach the new-password form without the email.
 *
 * Supabase stamps `recovery` when a reset link is used (token hash or PKCE code) and `otp`
 * for a one-time code. A normal sign-in is `password`; an email confirmation is
 * `email/signup`. Neither opens the form.
 */
export const RECOVERY_FRESH_MINUTES = 15;
const RECOVERY_METHODS = new Set(["recovery", "otp"]);

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

/** True when the session proves a reset link was used in the last 15 minutes. */
export function freshRecovery(amr: unknown, now = Date.now()): boolean {
  const oldest = now - RECOVERY_FRESH_MINUTES * 60_000;
  return amrEntries(amr).some(
    (e) => RECOVERY_METHODS.has(e.method) && e.timestamp * 1000 >= oldest && e.timestamp * 1000 <= now + 60_000, // a minute's clock skew
  );
}
