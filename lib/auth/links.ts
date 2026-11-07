import "server-only";
import { publicEnv } from "@/lib/env";
import { safeNext } from "./next";

/**
 * Where Supabase's emails send people back to. The address must also be on the Supabase
 * project's redirect allowlist (Auth > URL Configuration), or Supabase refuses it.
 * The email templates add &token_hash=…&type=… to it (see the sign-up PR for the wording).
 */
export function emailReturnUrl(next?: string | null): string {
  const url = new URL("/auth/confirm", publicEnv().NEXT_PUBLIC_SITE_URL);
  url.searchParams.set("flow", "signup"); // always a query, so the template can append "&token_hash=…"
  const safe = safeNext(next);
  if (safe) url.searchParams.set("next", safe);
  return url.toString();
}

/** The same, for password reset: lands on the set-a-new-password page once verified. */
export function resetReturnUrl(): string {
  const url = new URL("/auth/confirm", publicEnv().NEXT_PUBLIC_SITE_URL);
  url.searchParams.set("flow", "reset");
  return url.toString();
}

/**
 * An absolute URL on Ping for redirects from route handlers. Uses the configured site, not
 * the host the request reports: behind a proxy (or a server bound to a different hostname)
 * those can differ, and cookies set on one host don't follow the person to the other.
 */
export function siteUrl(path: string, request: { url: string }): URL {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  return new URL(path, configured ? new URL(configured).origin : request.url);
}

/** Set by app/auth/confirm after a reset link; the new-password page requires it. */
export const RESET_COOKIE = "ping-reset";

/** UK-friendly phone tidy-up to the shape profiles.phone accepts (^\+?[0-9 ]{7,20}$). */
export function tidyPhone(raw: string): string | null {
  const t = raw.trim().replace(/[()\-.]/g, " ").replace(/\s+/g, " ");
  if (!t) return null;
  return /^\+?[0-9 ]{7,20}$/.test(t) && t.replace(/\D/g, "").length >= 7 ? t : "invalid";
}
