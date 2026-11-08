import type { Enums } from "@/lib/db/types";

/**
 * "Cleans done today" as done / due. A cancelled clean (a block that ended) is no longer
 * due, so it's left out of both numbers rather than showing as a clean not done.
 */
export function cleansDoneToday(visits: readonly { status: Enums<"visit_status"> }[]): { done: number; due: number } {
  const due = visits.filter((v) => v.status !== "cancelled");
  return { done: due.filter((v) => v.status === "completed").length, due: due.length };
}
