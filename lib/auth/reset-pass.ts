/**
 * The reset pass: set when someone confirms a reset link, needed by the new-password page.
 * Bound to that user and an expiry, cleared on sign-out and once used. Defence in depth
 * only: Supabase's own "Secure password change" setting is what stops an existing session
 * changing the password without proof (see the sign-up PR's setup list).
 */
export const RESET_COOKIE = "ping-reset";
export const RESET_PASS_MINUTES = 15;
export const RESET_COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax", path: "/reset-password" } as const;

export function makeResetPass(userId: string, now = Date.now()): string {
  return `${userId}.${now + RESET_PASS_MINUTES * 60_000}`;
}

export function resetPassValid(value: string | undefined, userId: string | undefined, now = Date.now()): boolean {
  if (!value || !userId) return false;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return false;
  const expires = Number(value.slice(dot + 1));
  return value.slice(0, dot) === userId && Number.isFinite(expires) && expires > now && expires <= now + RESET_PASS_MINUTES * 60_000;
}
