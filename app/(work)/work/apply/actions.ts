"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";

export type ApplyState = { error?: string; ok?: boolean };

/**
 * Turns a signed-in customer into a cleaner applicant, through apply_as_cleaner() (the
 * only way to get the cleaner role without an admin). The role is never taken from the
 * browser: the function reads who is signed in, and refuses admins and anyone with a
 * regular clean of their own still running.
 */
export async function applyAsCleaner(): Promise<ApplyState> {
  const session = await getSession();
  if (!session) redirect("/login?next=/work/apply");
  if (session.role === "cleaner") return { ok: true }; // a second tap: already applied
  if (session.role !== "customer") return { error: "Ping team accounts can't apply to clean. Use a separate login." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_as_cleaner");
  if (error) {
    return {
      error: error.code === "42501"
        ? "You've got a regular clean booked with Ping. End it from your account first, then come back to apply."
        : "That didn't go through. Check your signal and try again.",
    };
  }
  // No redirect() here: this page itself sends cleaners away, and a re-render racing the
  // redirect lands in the wrong place. The button navigates once the action has finished.
  return { ok: true };
}
