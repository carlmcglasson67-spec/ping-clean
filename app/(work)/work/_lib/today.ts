import type { Enums } from "@/lib/db/types";

/**
 * Today's cleans that are still happening. Ending a block cancels its future cleans
 * instead of deleting them (payments PR 1), so a cancelled clean can sit on today's date.
 * It isn't work and earns nothing, so it never counts as "a clean today".
 */
export function cleansToDo<T extends { status: Enums<"visit_status"> }>(visits: readonly T[]): T[] {
  return visits.filter((v) => v.status !== "cancelled");
}

/** The cleaner home headline after "Hi Tara." */
export function todayHeadline(count: number): string {
  if (count === 0) return "Nothing booked today.";
  if (count === 1) return "One clean today.";
  return `${count} cleans today.`;
}
