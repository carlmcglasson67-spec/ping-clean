import { describe, expect, it } from "vitest";
import { claimOutcome } from "./claim";

describe("claim outcomes", () => {
  it("turns each claim_series error into something a cleaner can act on", () => {
    expect(claimOutcome("PC002")).toEqual({ ok: false, reason: "taken" });
    expect(claimOutcome("PC001")).toEqual({ ok: false, reason: "gone" });
    expect(claimOutcome("PC003")).toEqual({ ok: false, reason: "gone" });
    expect(claimOutcome("42501")).toEqual({ ok: false, reason: "blocked" });
  });

  it("treats anything unexpected as worth another tap, never as a raw error", () => {
    expect(claimOutcome(undefined)).toEqual({ ok: false, reason: "retry" });
    expect(claimOutcome("57014")).toEqual({ ok: false, reason: "retry" });
  });
});
