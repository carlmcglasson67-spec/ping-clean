import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { createClient } from "@/lib/db/server";
import { hasSupabaseEnv } from "@/lib/env";
import { amrEntries, type AmrEntry } from "./recovery";
import { canEnter, homeFor, type Role } from "./roles";

export type Session = {
  userId: string;
  email: string | null;
  role: Role;
  fullName: string | null;
  /** How this session was signed in (password, otp, …), from the signed token. */
  amr: AmrEntry[];
  /** The Supabase session this token belongs to (the reset pass is tied to it). */
  sessionId: string | null;
};

/**
 * The signed-in user, verified. getClaims() checks the JWT signature rather than
 * trusting the cookie, and the role comes from the profiles table (never from the
 * token or the browser). Memoised per request.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  await connection(); // per-request only: never prerender anything that depends on who's signed in
  if (!hasSupabaseEnv()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || !sub) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, email")
    .eq("id", sub)
    .maybeSingle();
  if (!profile) return null;

  return { userId: sub, email: profile.email, role: profile.role, fullName: profile.full_name, amr: amrEntries(data.claims.amr),
    sessionId: typeof data.claims.session_id === "string" ? data.claims.session_id : null };
});

/**
 * Guard for each app's layout and for every Server Action in it.
 * Signed out → login (coming back here afterwards). Wrong role → their own app.
 * This is a convenience layer: row level security is still what protects the data.
 */
export async function requireRole(area: Role, returnTo?: string): Promise<Session> {
  const session = await getSession();
  if (!session) {
    const next = returnTo ?? homeFor(area);
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  if (!canEnter(session.role, area)) redirect(homeFor(session.role));
  return session;
}

export function firstName(session: Pick<Session, "fullName" | "email">): string {
  const name = session.fullName?.trim().split(/\s+/)[0];
  return name || session.email?.split("@")[0] || "there";
}
