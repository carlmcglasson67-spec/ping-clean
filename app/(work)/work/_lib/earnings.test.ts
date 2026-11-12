import { describe, expect, it } from "vitest";
import { EARNING_COPY, earningNote, earningStep, earningTotals, type EarningRow } from "./earnings";

const now = new Date("2026-11-12T12:00:00Z");
const row = (payout: EarningRow["payout"], batch: EarningRow["batch"] = null, amountPence = 3750): EarningRow =>
  ({ visitId: "v", cleanDate: "2026-11-10", amountPence, payout, batch });
const po = (status: string, o: Partial<NonNullable<EarningRow["payout"]>> = {}) => ({ status, available_after: "2026-11-13T10:00:00Z", paid_at: null, ...o });
const day = (ymd: string) => `<${ymd}>`;

describe("earningStep", () => {
  it("follows the money from the clean to the bank", () => {
    expect(earningStep(row(null), now)).toBe("awaiting_payment");
    expect(earningStep(row(po("pending")), now)).toBe("checking");
    expect(earningStep(row(po("pending", { available_after: "2026-11-12T11:59:00Z" })), now)).toBe("next_payout");
    expect(earningStep(row(po("in_batch")), now)).toBe("sent");
    expect(earningStep(row(po("paid", { paid_at: "2026-11-12T08:00:00Z" })), now)).toBe("paid");
    expect(earningStep(row(po("failed")), now)).toBe("bank_refused");
    expect(earningStep(row(po("held")), now)).toBe("held");
    expect(earningStep(row(po("cancelled")), now)).toBe("cancelled");
  });
});

describe("earningNote", () => {
  it("gives the date that matters, and never a price, a fee or a number of hours", () => {
    expect(earningNote(row(po("pending")), "checking", day)).toBe("Goes to your bank after <2026-11-13>.");
    expect(earningNote(row(po("in_batch"), { status: "created", arrival_date: "2026-11-16" }), "sent", day)).toBe("Should reach your account on <2026-11-16>.");
    expect(earningNote(row(po("in_batch"), { status: "created", arrival_date: null }), "sent", day)).toBe("On its way to your account.");
    expect(earningNote(row(po("paid", { paid_at: "2026-11-11T09:00:00Z" })), "paid", day)).toBe("Reached your bank on <2026-11-11>.");
    const all = (Object.keys(EARNING_COPY) as (keyof typeof EARNING_COPY)[]).map((s) => EARNING_COPY[s].label + earningNote(row(po("pending"), { status: "created", arrival_date: null }), s, day));
    expect(all.join(" ")).not.toMatch(/£|\d+ ?(hours|%)/);
  });

  it("never says why a customer hasn't paid", () => {
    expect(earningNote(row(null), "awaiting_payment", day)).not.toMatch(/fail|declin|card was|unpaid|owe/i);
  });
});

describe("earningTotals", () => {
  it("adds up in whole pence: paid this month, on its way, waiting on the customer, refused", () => {
    const t = earningTotals([
      row(po("paid", { paid_at: "2026-11-03T09:00:00Z" }), null, 3750),
      row(po("paid", { paid_at: "2026-10-30T09:00:00Z" }), null, 3750), // last month
      row(po("pending"), null, 3750),
      row(po("in_batch"), null, 5625),
      row(null, null, 3750),
      row(po("failed"), null, 1875),
      row(po("cancelled"), null, 9999),
    ], "2026-11-01T00:00:00.000Z", now);
    expect(t).toEqual({ paidThisMonth: 3750, onItsWay: 9375, awaitingPayment: 3750, refused: 1875 });
  });
});
