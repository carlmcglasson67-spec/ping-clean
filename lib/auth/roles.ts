import type { Route } from "next";
import type { Enums } from "@/lib/db/types";
import { pathOf, safeNext } from "./next";

export type Role = Enums<"user_role">;

/** Each role's app. One login system, three surfaces. */
export const AREAS = {
  customer: "/account",
  cleaner: "/work",
  admin: "/admin",
} as const satisfies Record<Role, string>;

export type AreaPath = (typeof AREAS)[Role];

export function homeFor(role: Role): AreaPath {
  return AREAS[role];
}

/** Which role owns a path, or null for public pages. */
export function areaForPath(pathname: string): Role | null {
  for (const [role, base] of Object.entries(AREAS) as [Role, string][]) {
    if (pathname === base || pathname.startsWith(`${base}/`)) return role;
  }
  return null;
}

/**
 * Strict separation: each role uses only its own app. Admins included: they look at
 * customer and cleaner data through the admin console, which keeps every admin view
 * audited in one place rather than impersonating users.
 */
export function canEnter(role: Role, area: Role): boolean {
  return role === area;
}

/**
 * The few pages outside a role's own app that it may be sent to after signing in or up.
 * A customer becomes a cleaner applicant at /work/apply (shared request B1), so that one
 * path, exactly, is allowed for customers. Nothing else crosses areas.
 */
const CROSS_AREA: Partial<Record<Role, readonly string[]>> = {
  customer: ["/work/apply"],
};

/**
 * Where to send someone after sign-in or sign-up. ?next= is honoured only if it passes
 * the allowlist (lib/auth/next.ts) and is inside their own area, or is one of the exact
 * cross-area pages above. Anything else goes to their home.
 */
export function postLoginPath(role: Role, next: string | null | undefined): Route {
  const home = homeFor(role);
  const safe = safeNext(next);
  if (!safe) return home;
  const path = pathOf(safe);
  if (areaForPath(path) === role) return safe as Route;
  if (CROSS_AREA[role]?.includes(path)) return safe as Route;
  return home;
}
