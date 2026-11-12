import { describe, expect, it } from "vitest";
import { canTakeWork, PAYMENTS_COPY, paymentsStep, type StripeFlags } from "./payments";

const f = (o: Partial<StripeFlags> = {}): StripeFlags => ({
  stripe_charges_enabled: false, stripe_payouts_enabled: false, stripe_details_submitted: false,
  stripe_requirements_due: false, stripe_status_at: null, ...o,
});

describe("paymentsStep", () => {
  it("walks from not started to ready", () => {
    expect(paymentsStep(null)).toBe("todo");
    expect(paymentsStep(f())).toBe("todo");
    expect(paymentsStep(f({ stripe_status_at: "2026-11-12T10:00:00Z", stripe_requirements_due: true }))).toBe("started");
    expect(paymentsStep(f({ stripe_details_submitted: true, stripe_status_at: "x" }))).toBe("checking");
    expect(paymentsStep(f({ stripe_details_submitted: true, stripe_requirements_due: true, stripe_status_at: "x" }))).toBe("more");
    expect(paymentsStep(f({ stripe_charges_enabled: true, stripe_payouts_enabled: true, stripe_details_submitted: true }))).toBe("ready");
  });

  it("needs both card payments and payouts before work, like the database", () => {
    expect(canTakeWork(f({ stripe_charges_enabled: true, stripe_details_submitted: true }))).toBe(false);
    expect(canTakeWork(f({ stripe_payouts_enabled: true, stripe_details_submitted: true }))).toBe(false);
    expect(canTakeWork(f({ stripe_charges_enabled: true, stripe_payouts_enabled: true }))).toBe(true);
  });

  it("gives every step an action except the one where there's nothing to do", () => {
    for (const [step, c] of Object.entries(PAYMENTS_COPY)) expect(Boolean(c.action), step).toBe(step !== "checking");
  });

  it("never states a price, a fee or a number of hours (those are settings)", () => {
    expect(JSON.stringify(PAYMENTS_COPY)).not.toMatch(/£|\d+ ?(hours|%|p\b)/);
  });
});
