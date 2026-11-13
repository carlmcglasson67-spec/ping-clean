import { describe, expect, it } from "vitest";
import { canRefund, parsePounds, PAYMENT_STATUS, previewSplit, REFUND_REASONS, reasonsFor } from "./payments";

describe("parsePounds", () => {
  it("reads what a person types as whole pence", () => {
    expect(parsePounds("12.50")).toBe(1250);
    expect(parsePounds("£12.50")).toBe(1250);
    expect(parsePounds(" 12 ")).toBe(1200);
    expect(parsePounds("12.5")).toBe(1250);
    expect(parsePounds("0.07")).toBe(7);
    expect(parsePounds("19.99")).toBe(1999); // 19.99 × 100 is 1998.9999… as a float
    expect(parsePounds("0.29")).toBe(29);
  });

  it("refuses anything that isn't a positive amount to the penny", () => {
    for (const bad of ["", "0", "0.00", "-5", "12.505", "1,250", "12.", ".50", "abc", "1e3", "£", "999999"]) expect({ bad, v: parsePounds(bad) }).toEqual({ bad, v: null });
  });
});

describe("previewSplit", () => {
  const clean = { amount_pence: 5000, application_fee_pence: 1250 };
  it("matches the database's split for a shared refund, to the penny", () => {
    expect(previewSplit(1000, clean, true)).toEqual({ cleaner: 750, ping: 250 });
    expect(previewSplit(333, clean, true)).toEqual({ cleaner: 250, ping: 83 }); // 83.25 → 83
    expect(previewSplit(5000, clean, true)).toEqual({ cleaner: 3750, ping: 1250 });
    expect(previewSplit(2, clean, true)).toEqual({ cleaner: 1, ping: 1 }); // 0.5 rounds up, as the database's round() does
  });
  it("Ping carries all of a refund that isn't shared", () => {
    expect(previewSplit(5000, clean, false)).toEqual({ cleaner: 0, ping: 5000 });
  });
  it("always adds up, for every amount", () => {
    for (let p = 1; p <= 5000; p += 7) {
      const s = previewSplit(p, clean, true);
      expect(s.cleaner + s.ping).toBe(p);
      expect(Number.isInteger(s.ping) && s.ping >= 0 && s.cleaner >= 0).toBe(true);
    }
  });
});

describe("labels", () => {
  it("only money that was taken and still stands can be refunded", () => {
    expect(Object.keys(PAYMENT_STATUS).filter(canRefund)).toEqual(["succeeded", "partially_refunded"]);
  });
  it("the reasons are the database's six, and which are shared matches it", () => {
    expect(REFUND_REASONS.map((r) => [r.value, r.shared])).toEqual([["clean_quality", true], ["no_show", true], ["fee_waived", true], ["ping_error", false], ["goodwill", false], ["other", false]]);
  });
  it("a fee is never offered a reason that faults a clean, and a clean is never offered 'fee waived'", () => {
    expect(reasonsFor("late_cancel").map((r) => r.value)).toEqual(["fee_waived", "ping_error", "goodwill", "other"]);
    expect(reasonsFor("visit").map((r) => r.value)).toEqual(["clean_quality", "no_show", "ping_error", "goodwill", "other"]);
  });
});
