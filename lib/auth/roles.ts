import type { Route } from "next";
import type { Enums } from "@/lib/db/types";

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
 * Where to send someone after sign-in. Honour ?next= only if it is a same-site path
 * inside their own area, so a crafted link can't bounce them anywhere else.
 */
export function postLoginPath(role: Role, next: string | null | undefined): Route {
  const home = homeFor(role);
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return home;
  const area = areaForPath(next);
  // Validated above: a same-site path inside the user's own area.
  return (area === role ? next : home) as Route;
}
