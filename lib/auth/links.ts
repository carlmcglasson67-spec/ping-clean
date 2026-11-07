import "server-only";
import { requireSiteUrl, resolveSiteUrl } from "@/lib/env";
import { safeNext } from "./next";

/**
 * Where Supabase's emails send people back to. The address must be on the Supabase
 * project's redirect allowlist (Auth > URL Configuration) as an EXACT URL, never a wildcard
 * on a shared domain such as *.vercel.app: anyone can host a page there and ask Supabase to
 * send a victim's reset link to it. The templates add &token_hash=…&type=… (see the PR).
 */
export function emailReturnUrl(next?: string | null): string {
  const url = new URL("/auth/confirm", requireSiteUrl());
  url.searchParams.set("flow", "signup"); // always a query, so the template can append "&token_hash=…"
  const safe = safeNext(next);
  if (safe) url.searchParams.set("next", safe);
  return url.toString();
}

/** The same, for password reset: goes on to choose a new password once confirmed. */
export function resetReturnUrl(): string {
  const url = new URL("/auth/confirm", requireSiteUrl());
  url.searchParams.set("flow", "reset");
  return url.toString();
}

/**
 * An absolute URL on Ping for redirects. Uses the configured site, not the host the
 * request reports: behind a proxy (or a server bound to a different hostname) those can
 * differ, and cookies set on one host don't follow the person to the other.
 */
export function siteUrl(path: string, request: { url: string }): URL {
  return new URL(path, resolveSiteUrl() ?? request.url);
}

/** UK-friendly phone tidy-up to the shape profiles.phone accepts (^\+?[0-9 ]{7,20}$). */
export function tidyPhone(raw: string): string | null {
  const t = raw.trim().replace(/[()\-.]/g, " ").replace(/\s+/g, " ");
  if (!t) return null;
  return /^\+?[0-9 ]{7,20}$/.test(t) && t.replace(/\D/g, "").length >= 7 ? t : "invalid";
}
