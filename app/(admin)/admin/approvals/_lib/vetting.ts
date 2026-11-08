import { z } from "zod";
import type { Enums } from "@/lib/db/types";

export type DocKind = Enums<"document_kind">;
export type DocStatus = Enums<"document_status">;

/** The four checks every Ping cleaner passes, in the order the team reads them. */
export const REQUIRED_DOCS: DocKind[] = ["photo_id", "right_to_work", "dbs", "insurance"];

export type DocRow = { id: string; cleaner_id: string; kind: DocKind; status: DocStatus; expires_on: string | null; created_at: string };

/** The newest document of each kind: the one that counts. Older ones are history. */
export function latestByKind<T extends Pick<DocRow, "kind" | "created_at">>(docs: readonly T[]): Map<DocKind, T> {
  const out = new Map<DocKind, T>();
  for (const d of docs) {
    const cur = out.get(d.kind);
    if (!cur || d.created_at > cur.created_at) out.set(d.kind, d);
  }
  return out;
}

/**
 * Where a cleaner's paperwork stands for approval: which of the four kinds still need a
 * verified, in-date document. Display only: shared request C-1 has the database make the
 * real decision.
 */
export function readiness(docs: readonly DocRow[], today: string) {
  const latest = latestByKind(docs);
  const waiting: DocKind[] = [];
  for (const kind of REQUIRED_DOCS) {
    const d = latest.get(kind);
    const inDate = !d?.expires_on || d.expires_on > today;
    if (!d || d.status !== "verified" || !inDate) waiting.push(kind);
  }
  return { ready: waiting.length === 0, waiting, toCheck: [...latest.values()].filter((d) => d.status === "pending").length };
}

/** Out of date on `today` (London, YYYY-MM-DD): its expiry or cover-end date has come. */
export function isOutOfDate(expiresOn: string | null | undefined, today: string): boolean {
  return !!expiresOn && expiresOn <= today;
}

/** A reason a person can act on: a real word or more, at most 300 characters (the database's rule). */
export const reason = z
  .string()
  .trim()
  .max(300, "Keep it to 300 characters.")
  .regex(/[\p{L}\p{N}]{3,}/u, "Say why, in a few words.");

export const reviewInput = z.discriminatedUnion("decision", [
  // An expired document is never verified: the cleaner sends a new one.
  z.object({ decision: z.literal("verify"), documentId: z.string(), expected: z.enum(["pending", "rejected"]) }),
  z.object({ decision: z.literal("reject"), documentId: z.string(), expected: z.enum(["pending", "verified"]), reason }),
]);
