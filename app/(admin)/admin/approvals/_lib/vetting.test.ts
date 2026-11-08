import { describe, expect, it } from "vitest";
import { latestByKind, readiness, reviewInput, type DocRow } from "./vetting";

const doc = (kind: DocRow["kind"], status: DocRow["status"], created_at: string, expires_on: string | null = null): DocRow => ({
  id: `${kind}-${created_at}`, cleaner_id: "c", kind, status, expires_on, created_at,
});

describe("vetting", () => {
  it("the newest document of each kind is the one that counts", () => {
    const m = latestByKind([doc("dbs", "rejected", "2026-11-01"), doc("dbs", "pending", "2026-11-03")]);
    expect(m.get("dbs")?.status).toBe("pending");
  });

  it("is ready only with all four verified and in date", () => {
    const four = [doc("photo_id", "verified", "a"), doc("right_to_work", "verified", "a"), doc("dbs", "verified", "a"), doc("insurance", "verified", "a", "2027-01-01")];
    expect(readiness(four, "2026-11-08")).toEqual({ ready: true, waiting: [], toCheck: 0 });
    expect(readiness(four, "2027-01-01").waiting).toEqual(["insurance"]);
    expect(readiness(four.slice(0, 3), "2026-11-08").waiting).toEqual(["insurance"]);
    expect(readiness([...four.slice(1), doc("photo_id", "pending", "b")], "2026-11-08")).toMatchObject({ ready: false, waiting: ["photo_id"], toCheck: 1 });
  });

  it("a send-back needs a real reason", () => {
    const base = { decision: "reject", documentId: "x", expected: "pending" } as const;
    expect(reviewInput.safeParse({ ...base, reason: "  " }).success).toBe(false);
    expect(reviewInput.safeParse({ ...base, reason: "..!!" }).success).toBe(false);
    expect(reviewInput.safeParse({ ...base, reason: "x".repeat(301) }).success).toBe(false);
    expect(reviewInput.safeParse({ ...base, reason: "Photo is cut off" }).success).toBe(true);
  });

  it("only moves a document from a status it can leave", () => {
    expect(reviewInput.safeParse({ decision: "verify", documentId: "x", expected: "verified" }).success).toBe(false);
    expect(reviewInput.safeParse({ decision: "reject", documentId: "x", expected: "rejected", reason: "Again please" }).success).toBe(false);
  });
});
