import { pingErrorMessage } from "@/lib/db/errors";

/**
 * The admin console's wording for database errors. lib/db/errors.ts has one message per
 * code, written for the person who usually meets it (PC001 "That job isn't available to
 * you" is for a cleaner). The same codes mean something else when the Ping team assigns
 * or ends a job, so a few are reworded here. Everything else falls through to the shared
 * list, so no raw database text ever reaches the page.
 * (Shared request C-3 asks for these to move into lib/db/errors.ts.)
 */
const ADMIN_WORDING: Record<string, string> = {
  PC001: "That cleaner isn't active any more, so the job can't go to them.",
  PC002: "That job has already been taken or isn't open any more. Refresh to see where it stands.",
  PC004: "That block has no cleans left that could go ahead on its dates, so it can't be given to anyone.",
  PC005: "That block has already ended.",
  "22023": "Say why, in a few words (up to 300 characters).",
  "42501": "Only the Ping team can do that. Sign in again with your admin account.",
};

export function adminErrorMessage(error: { code?: string | null } | null | undefined): string {
  const code = error?.code;
  if (code && code in ADMIN_WORDING) return ADMIN_WORDING[code]!;
  return pingErrorMessage(error);
}

/** What every admin Server Action returns: done, or plain words for the person. */
export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };

export const NOT_SAVED = "That didn't go through. Check your connection and try again.";
