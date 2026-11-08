import { describe, expect, it } from "vitest";
import { PING_ERRORS } from "@/lib/db/errors";
import { CLAIM_COPY, claimOutcome } from "./claim";

describe("claim outcomes", () => {
  it("turns each claim_series error into something a cleaner can act on", () => {
    expect(claimOutcome("PC002")).toEqual({ ok: false, reason: "taken" });
    expect(claimOutcome("PC001")).toEqual({ ok: false, reason: "gone" });
    expect(claimOutcome("PC003")).toEqual({ ok: false, reason: "gone" }); // incl. a block the admin ended
    expect(claimOutcome("PC004")).toEqual({ ok: false, reason: "no-dates" });
    expect(claimOutcome("42501")).toEqual({ ok: false, reason: "blocked" });
  });

  it("treats anything unexpected as worth another tap, never as a raw error", () => {
    expect(claimOutcome(undefined)).toEqual({ ok: false, reason: "retry" });
    expect(claimOutcome("57014")).toEqual({ ok: false, reason: "retry" });
  });

  it("uses the shared wording for the database's own codes", () => {
    expect(CLAIM_COPY.taken.title).toBe(PING_ERRORS.PC002);
    expect(CLAIM_COPY.gone.title).toBe(PING_ERRORS.PC003);
    expect(CLAIM_COPY["no-dates"].title).toBe(PING_ERRORS.PC004);
  });
});
