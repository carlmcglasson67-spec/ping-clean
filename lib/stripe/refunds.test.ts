// Refunds and chargebacks (payments PR 10), with the real Stripe library talking to the local fake Stripe.
import type Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeStripe, stripeEvent, TEST_SECRET_KEY, type FakeStripe } from "../../tests/stripe/fake-stripe.mjs";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
vi.mock("@/lib/db/admin", () => ({ createAdminClient: () => ({ rpc }) }));

const PORT = 13_900 + Math.floor(Math.random() * 400);
let fake: FakeStripe;
const REFUND = "00000000-0000-4000-f300-0000000000aa";
const PI = "pi_testPaidClean00001";

beforeAll(async () => {
  fake = await startFakeStripe(PORT);
  vi.stubEnv("STRIPE_SECRET_KEY", TEST_SECRET_KEY);
  vi.stubEnv("STRIPE_API_BASE", fake.url);
});
afterAll(async () => { vi.unstubAllEnvs(); await fake.stop(); });

const { onDisputeEvent, onRefundEvent, readRefund, resendRefunds, sendRefund } = await import("./refunds");

const toSend = (over: Record<string, unknown> = {}) => ({ refund_id: REFUND, payment_intent_id: PI, amount_pence: 1000, shared: true, idempotency_key: `refund:${REFUND}`, ...over });
function db(opts: { send?: Record<string, unknown> | null; unsent?: Record<string, unknown>[] } = {}) {
  const calls: [string, Record<string, unknown>][] = [];
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push([fn, args]);
    if (fn === "refund_to_send") return { data: opts.send === null ? [] : [opts.send ?? toSend()], error: null };
    if (fn === "refunds_open") return { data: opts.unsent ?? [], error: null };
    if (fn === "stripe_refund_result") return { data: args.p_outcome, error: null };
    if (fn === "stripe_dispute") return { data: args.p_outcome === "opened" ? "disputed" : args.p_outcome, error: null };
    return { data: null, error: { code: "XX000" } };
  });
  return { calls, of: (fn: string) => calls.filter((c) => c[0] === fn).map((c) => c[1]) };
}

beforeEach(async () => {
  rpc.mockReset();
  await fetch(`${fake.url}/__test/reset`, { method: "POST" });
  // A £50 clean, paid.
  fake.state.paymentIntents.set(PI, { id: PI, object: "payment_intent", amount: 5000, currency: "gbp", status: "succeeded" } as never);
});

describe("sending a refund", () => {
  it("shared with the cleaner: reverses their part and refunds Ping's fee, once, keyed to the refund", async () => {
    const d = db();
    expect(await sendRefund(REFUND)).toBe("succeeded");
    const re = [...fake.state.refunds.values()][0]!;
    expect(re).toMatchObject({ amount: 1000, payment_intent: PI, metadata: { refund_id: REFUND }, __reverse_transfer: true, __refund_application_fee: true });
    expect(fake.state.requests).toEqual([{ method: "POST", path: "/v1/refunds", idempotencyKey: `refund:${REFUND}` }]);
    expect(d.of("stripe_refund_result")).toEqual([{ p_refund: REFUND, p_stripe_refund: re.id, p_outcome: "succeeded", p_amount: 1000, p_error: null, p_payment_intent: PI }]);
  });

  it("carried by Ping alone: the cleaner's transfer and Ping's fee are left where they are", async () => {
    db({ send: toSend({ shared: false, amount_pence: 5000 }) });
    await sendRefund(REFUND);
    expect([...fake.state.refunds.values()][0]).toMatchObject({ amount: 5000, __reverse_transfer: false, __refund_application_fee: false });
  });

  it("sent twice, Stripe makes one refund", async () => {
    db();
    await sendRefund(REFUND);
    await sendRefund(REFUND);
    expect(fake.state.refunds.size).toBe(1);
  });

  it("a refund Stripe says is still going through is recorded as on its way", async () => {
    await fetch(`${fake.url}/__test/refund-status`, { method: "POST", body: JSON.stringify({ status: "pending" }) });
    const d = db();
    expect(await sendRefund(REFUND)).toBe("pending");
    expect(d.of("stripe_refund_result")[0]).toMatchObject({ p_outcome: "pending" });
  });

  it("a refund Stripe refuses is recorded as failed, with Stripe's reason", async () => {
    const d = db({ send: toSend({ amount_pence: 5001 }) }); // more than the charge
    expect(await sendRefund(REFUND)).toBe("failed");
    expect(d.of("stripe_refund_result")).toEqual([{ p_refund: REFUND, p_stripe_refund: null, p_outcome: "failed", p_amount: 5001, p_error: "stripe_charge_already_refunded" }]);
    expect(fake.state.refunds.size).toBe(0);
  });

  it("when Stripe can't be reached it's left for the job, and nothing is recorded as failed", async () => {
    await fetch(`${fake.url}/__test/down`, { method: "POST", body: "{}" });
    const d = db();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendRefund(REFUND)).toBe("unsent");
    expect(d.of("stripe_refund_result")).toEqual([]);
    err.mockRestore();
  });

  it("sends nothing for an id that isn't a refund, or one the database has nothing to send for", async () => {
    db({ send: null });
    expect(await sendRefund("1; drop table refunds")).toBe("unsent");
    expect(await sendRefund(REFUND)).toBe("unsent");
    expect(fake.state.requests).toEqual([]);
  });

  it("the job sends the ones that never reached Stripe, and one failing doesn't stop the next", async () => {
    const other = "00000000-0000-4000-f300-0000000000bb";
    const d = db({ unsent: [toSend({ mode: "send", stripe_refund_id: null, payment_intent_id: "pi_testNoSuchIntent01" }), toSend({ mode: "send", stripe_refund_id: null, refund_id: other, idempotency_key: `refund:${other}` })] });
    const run = await resendRefunds();
    expect(run).toEqual({ sent: 2, checked: 0, errors: 0 });
    expect(d.of("stripe_refund_result").map((r) => [r.p_refund, r.p_outcome])).toEqual([[REFUND, "failed"], [other, "succeeded"]]);
  });
});

describe("chasing a refund Stripe hasn't answered on", () => {
  it("asks Stripe for it and records where it has got to", async () => {
    await fetch(`${fake.url}/__test/refund-status`, { method: "POST", body: JSON.stringify({ status: "pending" }) });
    db();
    await sendRefund(REFUND);
    const re = [...fake.state.refunds.values()][0]!;
    re.status = "succeeded"; // Stripe finished it; the webhook never arrived
    const d = db({ unsent: [toSend({ mode: "check", stripe_refund_id: re.id })] });
    expect(await resendRefunds()).toEqual({ sent: 0, checked: 1, errors: 0 });
    expect(d.of("stripe_refund_result")).toEqual([{ p_refund: REFUND, p_stripe_refund: re.id, p_outcome: "succeeded", p_amount: 1000, p_error: null, p_payment_intent: PI }]);
    expect(fake.state.refunds.size).toBe(1);
  });
});

describe("reading a refund", () => {
  const re = (o: Record<string, unknown>) => ({ id: "re_testRead000001", amount: 1000, ...o }) as unknown as Stripe.Refund;
  it("succeeded, failed with Stripe's reason, cancelled, and anything else is still on its way", () => {
    expect(readRefund(re({ status: "succeeded" }))).toEqual({ outcome: "succeeded", error: null });
    expect(readRefund(re({ status: "failed", failure_reason: "expired_or_canceled_card" }))).toEqual({ outcome: "failed", error: "expired_or_canceled_card" });
    expect(readRefund(re({ status: "failed", failure_reason: "Free text!" }))).toEqual({ outcome: "failed", error: "refund_failed" });
    expect(readRefund(re({ status: "canceled" }))).toEqual({ outcome: "failed", error: "canceled" });
    expect(readRefund(re({ status: "pending" }))).toEqual({ outcome: "pending", error: null });
    expect(readRefund(re({ status: "requires_action" }))).toEqual({ outcome: "pending", error: null });
  });
});

describe("refund and dispute webhooks", () => {
  const refund = (over: Record<string, unknown> = {}) => ({ id: "re_testHook000001", object: "refund", amount: 1000, currency: "gbp", status: "succeeded", failure_reason: null, payment_intent: PI, metadata: { refund_id: REFUND }, ...over });
  const ev = (type: string, o: Record<string, unknown>) => stripeEvent(type, o) as unknown as Stripe.Event;

  it("refund.updated records Stripe's state for the refund named in it", async () => {
    const d = db();
    await onRefundEvent(ev("refund.updated", refund()));
    expect(d.of("stripe_refund_result")).toEqual([{ p_refund: REFUND, p_stripe_refund: "re_testHook000001", p_outcome: "succeeded", p_amount: 1000, p_error: null, p_payment_intent: PI }]);
  });

  it("refund.failed is a failure whatever the snapshot's status says", async () => {
    const d = db();
    await onRefundEvent(ev("refund.failed", refund({ status: "succeeded", failure_reason: "lost_or_stolen_card" })));
    expect(d.of("stripe_refund_result")[0]).toMatchObject({ p_outcome: "failed", p_error: "lost_or_stolen_card" });
  });

  it("ignores a refund made by hand in Stripe (no name), or with a made-up name", async () => {
    const d = db();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await onRefundEvent(ev("refund.created", refund({ metadata: {} })));
    await onRefundEvent(ev("refund.updated", refund({ metadata: { refund_id: "' or 1=1" } })));
    expect(d.calls).toEqual([]);
    warn.mockRestore();
  });

  it("a chargeback opened, then won, lost, or a warning closed", async () => {
    const d = db();
    const dispute = (status: string) => ({ id: "dp_testDispute0001", object: "dispute", amount: 5000, status, payment_intent: PI });
    await onDisputeEvent(ev("charge.dispute.created", dispute("needs_response")));
    await onDisputeEvent(ev("charge.dispute.closed", dispute("won")));
    await onDisputeEvent(ev("charge.dispute.closed", dispute("lost")));
    await onDisputeEvent(ev("charge.dispute.closed", dispute("warning_closed")));
    expect(d.of("stripe_dispute")).toEqual([
      { p_payment_intent: PI, p_outcome: "opened" }, { p_payment_intent: PI, p_outcome: "won" },
      { p_payment_intent: PI, p_outcome: "lost" }, { p_payment_intent: PI, p_outcome: "won" },
    ]);
  });

  it("a dispute naming no payment is ignored; a database failure asks Stripe to retry", async () => {
    const d = db();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await onDisputeEvent(ev("charge.dispute.created", { id: "dp_testDispute0002", object: "dispute", status: "needs_response", payment_intent: null }));
    expect(d.calls).toEqual([]);
    warn.mockRestore();
    rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
    await expect(onDisputeEvent(ev("charge.dispute.created", { id: "dp_testDispute0003", object: "dispute", status: "needs_response", payment_intent: PI }))).rejects.toThrow(/couldn't record/);
    await expect(onRefundEvent(ev("refund.updated", refund()))).rejects.toThrow(/couldn't record/);
  });
});
