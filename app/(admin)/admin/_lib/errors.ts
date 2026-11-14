import { pingErrorMessage } from "@/lib/db/errors";

/**
 * The admin console's wording for database errors: the shared list in lib/db/errors.ts,
 * read for the Ping team (PC001 means something else when the team assigns a job than
 * when a cleaner claims one). No raw database text ever reaches the page.
 */
export function adminErrorMessage(error: { code?: string | null; message?: string | null } | null | undefined): string {
  return pingErrorMessage(error, { audience: "admin" });
}

/** What every admin Server Action returns: done, or plain words for the person. */
export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };

export const NOT_SAVED = "That didn't go through. Check your connection and try again.";
