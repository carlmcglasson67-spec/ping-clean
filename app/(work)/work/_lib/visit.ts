import { z } from "zod";
import { pgUuid } from "./ids";

/**
 * A "couldn't do" reason, by the database's rule (checklist_skip_reason): at least one
 * word of 3+ letters or digits, at most 300 characters. "..." or "n/a" isn't a reason.
 */
export const REASON_MAX = 300;
export function isRealReason(reason: string): boolean {
  return /[\p{L}\p{N}]{3,}/u.test(reason) && reason.length <= REASON_MAX;
}

/** One checklist item's state. Ticked, or "couldn't do" with a reason, or neither yet. Never both. */
export const itemChange = z
  .object({
    visitId: pgUuid,
    itemId: pgUuid,
    done: z.boolean(),
    reason: z.string().trim().max(REASON_MAX).nullable(),
  })
  .refine((c) => !(c.done && c.reason), { message: "An item is ticked or couldn't be done, not both." })
  .refine((c) => c.reason === null || isRealReason(c.reason), { message: "Say why in a few words." });
export type ItemChange = z.infer<typeof itemChange>;

/** Photos go to visit-photos/<visit id>/<kind>-<random uuid>.jpg|png|webp|heic. */
export const PHOTO_PATH = /^([0-9a-f-]{36})\/(before|after)-[0-9a-f-]{36}\.(jpg|png|webp|heic)$/;
export function photoPath(visitId: string, kind: "before" | "after", ext: "jpg" | "png" | "webp" | "heic", random: string) {
  return `${visitId}/${kind}-${random}.${ext}`;
}

/** Longest side of a visit photo after shrinking on the phone: plenty for QC, quick to send. */
export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024; // the visit-photos bucket limit

/** Plain words for how far through the checklist they are. */
export function checklistProgress(items: { done: boolean; skipped_reason: string | null }[]) {
  const resolved = items.filter((i) => i.done || (i.skipped_reason && isRealReason(i.skipped_reason))).length;
  return { resolved, total: items.length, left: items.length - resolved };
}
