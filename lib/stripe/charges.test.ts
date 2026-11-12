// The charge job and its webhooks (payments PR 6), with the real Stripe library talking to
// the local fake Stripe. The database is stood in for by the calls the job makes.
import type Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeStripe, stripeEvent, TEST_SECRET_KEY, type FakeStripe } from "../../tests/stripe/fake-stripe.mjs";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
vi.mock("@/lib/db/admin", () => ({ createAdminClient: () => ({ rpc }) }));

const PORT = 12_900 + Math.floor(Math.random() * 400);
let fake: FakeStripe;

beforeAll(async () => {
  fake = await startFakeStripe(PORT);
  vi.stubEnv("STRIPE_SECRET_KEY", TEST_SECRET_KEY);
  vi.stubEnv("STRIPE_API_BASE", fake.url);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-tests-0000000000");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await fake.stop(); });

const { jobRequestAllowed, jobSecret, onPaymentIntentEvent, readIntent, readStripeError, runChargeJob } = await import("./charges");

const PAYMENT = "00000000-0000-4000-f000-0000000000aa";
const VISIT = "00000000-0000-4000-e000-000000000002";
const ACCT = "acct_testCleaner0001";
const row = (over: Record<string, unknown> = {}) => ({
  payment_id: PAYMENT, mode: "create", visit_id: VISIT, amount_pence: 5000, application_fee_pence: 1250,
  stripe_customer_id: "cus_testAnna000001", payment_method_id: "pm_testCard000001", cleaner_account_id: ACCT,
  payment_intent_id: null, attempt: 1, idempotency_key: `payment:${PAYMENT}`, ...over,
});

async function card(behaviour: "ok" | "decline" | "auth", id = "pm_testCard000001") {
  await fetch(`${fake.url}/__test/payment_methods`, { method: "POST", body: JSON.stringify({ id, customer: "cus_testAnna000001", behaviour }) });
}

/** The database's side: hands out `rows` once, and remembers what the job reported. */
function db(rows: ReturnType<typeof row>[], answer: (args: Record<string, unknown>) => string = (a) => a.p_outcome as string) {
  const results: Record<string, unknown>[] = [];
  const notSent: Record<string, unknown>[] = [];
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "charge_claim") return { data: rows, error: null };
    if (fn === "stripe_payment_result") { results.push(args); return { data: answer(args), error: null }; }
    if (fn === "charge_not_sent") { notSent.push(args); return { data: "failed", error: null }; }
    return { data: null, error: { code: "XX000" } };
  });
  return { results, notSent };
}

beforeEach(async () => {
  rpc.mockReset();
  await fetch(`${fake.url}/__test/reset`, { method: "POST" });
});

describe("the charge job", () => {
  it("makes one destination charge on the cleaner's behalf, with Ping's fee split off, and records it", async () => {
    await card("ok");
    const { results } = db([row()]);
    const run = await runChargeJob();
    expect(run).toEqual({ claimed: 1, succeeded: 1, failed: 0, needsCustomer: 0, waiting: 0, errors: 0 });

    const [pi] = [...fake.state.paymentIntents.values()];
    expect(pi).toMatchObject({
      amount: 5000, currency: "gbp", application_fee_amount: 1250, on_behalf_of: ACCT, transfer_data: { destination: ACCT },
      customer: "cus_testAnna000001", status: "succeeded", metadata: { payment_id: PAYMENT, visit_id: VISIT },
    });
    expect(fake.state.requests.filter((r) => r.method === "POST" && r.path === "/v1/payment_intents")).toEqual([
      { method: "POST", path: "/v1/payment_intents", idempotencyKey: `payment:${PAYMENT}` },
    ]);
    expect(results).toEqual([{
      p_payment: PAYMENT, p_intent: pi!.id, p_outcome: "succeeded", p_amount: 5000, p_fee: 1250, p_destination: ACCT,
      p_charge: expect.stringMatching(/^ch_/), p_error: null, p_event_at: null,
    }]);
  });

  it("sending the same try twice makes one PaymentIntent, not two", async () => {
    await card("ok");
    db([row()]);
    await runChargeJob();
    db([row()]); // the try died before it was recorded, so it is claimed again
    await runChargeJob();
    expect(fake.state.paymentIntents.size).toBe(1);
  });

  it("records a declined card as a failed try, with the bank's reason", async () => {
    await card("decline");
    const { results } = db([row()]);
    const run = await runChargeJob();
    expect(run).toMatchObject({ failed: 1, succeeded: 0, errors: 0 });
    expect(results[0]).toMatchObject({ p_outcome: "failed", p_error: "insufficient_funds", p_amount: 5000, p_fee: 1250, p_destination: ACCT });
    expect(results[0]!.p_intent).toMatch(/^pi_/);
  });

  it("waits for the customer when their bank wants them to confirm", async () => {
    await card("auth");
    const { results } = db([row()]);
    const run = await runChargeJob();
    expect(run).toMatchObject({ needsCustomer: 1, failed: 0 });
    expect(results[0]).toMatchObject({ p_outcome: "requires_action", p_error: null });
  });

  it("a retry confirms the same PaymentIntent again, with its own key, and never makes a new one", async () => {
    await card("decline");
    db([row()]);
    await runChargeJob();
    const [pi] = [...fake.state.paymentIntents.values()];

    await card("ok"); // the customer has sorted their card
    const { results } = db([row({ mode: "retry", payment_intent_id: pi!.id, attempt: 2 })]);
    const run = await runChargeJob();
    expect(run).toMatchObject({ succeeded: 1 });
    expect(fake.state.paymentIntents.size).toBe(1);
    expect(fake.state.requests.at(-1)).toEqual({ method: "POST", path: `/v1/payment_intents/${pi!.id}/confirm`, idempotencyKey: `payment:${PAYMENT}:confirm:2` });
    expect(results[0]).toMatchObject({ p_intent: pi!.id, p_outcome: "succeeded" });
  });

  it("asks Stripe what happened to a try that never answered, without charging again", async () => {
    await card("ok");
    db([row()]);
    await runChargeJob();
    const [pi] = [...fake.state.paymentIntents.values()];
    const before = fake.state.requests.length;
    const { results } = db([row({ mode: "check", payment_intent_id: pi!.id, stripe_customer_id: null, payment_method_id: null })]);
    await runChargeJob();
    expect(fake.state.requests.slice(before)).toEqual([{ method: "GET", path: `/v1/payment_intents/${pi!.id}`, idempotencyKey: null }]);
    expect(results[0]).toMatchObject({ p_intent: pi!.id, p_outcome: "succeeded" });
  });

  it("a request Stripe refuses outright is noted as not sent, and the others still go", async () => {
    await card("ok");
    const other = "00000000-0000-4000-f000-0000000000bb";
    const { results, notSent } = db([
      row({ cleaner_account_id: "not-an-account" }),
      row({ payment_id: other, idempotency_key: `payment:${other}` }),
    ]);
    const run = await runChargeJob();
    expect(run).toMatchObject({ claimed: 2, failed: 1, succeeded: 1, errors: 0 });
    expect(notSent).toEqual([{ p_payment: PAYMENT, p_error: "stripe_invalid_request" }]);
    expect(results.map((r) => r.p_payment)).toEqual([other]);
  });

  it("leaves a try alone when Stripe can't be reached or the answer can't be saved", async () => {
    await card("ok");
    rpc.mockImplementation(async (fn: string) =>
      fn === "charge_claim" ? { data: [row()], error: null } : { data: null, error: { code: "08006" } });
    expect(await runChargeJob()).toMatchObject({ claimed: 1, errors: 1, succeeded: 0, failed: 0 });
  });

  it("counts an answer that doesn't match the row as an error, not a payment", async () => {
    await card("ok");
    db([row()], () => "mismatch");
    expect(await runChargeJob()).toMatchObject({ errors: 1, succeeded: 0 });
  });
});

describe("reading Stripe's answers", () => {
  const pi = (over: Record<string, unknown>) => ({ id: "pi_test000001", amount: 5000, application_fee_amount: 1250,
    transfer_data: { destination: ACCT }, latest_charge: "ch_test000001", last_payment_error: null, ...over }) as unknown as Stripe.PaymentIntent;

  it("maps each status", () => {
    expect(readIntent(pi({ status: "succeeded" }))).toEqual({ intentId: "pi_test000001", outcome: "succeeded", amount: 5000, fee: 1250, destination: ACCT, chargeId: "ch_test000001", error: null });
    expect(readIntent(pi({ status: "processing" })).outcome).toBe("processing");
    expect(readIntent(pi({ status: "requires_action" })).outcome).toBe("requires_action");
    expect(readIntent(pi({ status: "canceled" }))).toMatchObject({ outcome: "failed", error: "canceled" });
    expect(readIntent(pi({ status: "requires_payment_method", last_payment_error: { code: "card_declined", decline_code: "lost_card" } }))).toMatchObject({ outcome: "failed", error: "lost_card" });
    expect(readIntent(pi({ status: "requires_payment_method", last_payment_error: { code: "authentication_required" } }))).toMatchObject({ outcome: "requires_action", error: null });
    expect(readIntent(pi({ status: "requires_payment_method" }))).toMatchObject({ outcome: "failed", error: "payment_failed" });
  });

  it("never stores free text from an error as a code", () => {
    expect(readIntent(pi({ status: "requires_payment_method", last_payment_error: { code: "Card DECLINED: call 0800…" } })).error).toBe("payment_failed");
    expect(readStripeError({ type: "StripeInvalidRequestError", code: "No such destination: acct_x" })).toEqual({ kind: "refused", error: "stripe_invalid_request" });
  });

  it("tells an answer from a refusal from not knowing", () => {
    expect(readStripeError({ type: "StripeCardError", code: "card_declined", payment_intent: pi({ status: "requires_payment_method", last_payment_error: { code: "card_declined" } }) }))
      .toMatchObject({ kind: "answer", result: { outcome: "failed", error: "card_declined" } });
    expect(readStripeError({ type: "StripeInvalidRequestError", code: "account_invalid" })).toEqual({ kind: "refused", error: "stripe_account_invalid" });
    expect(readStripeError({ type: "StripeConnectionError" })).toEqual({ kind: "unknown" });
    expect(readStripeError(new Error("boom"))).toEqual({ kind: "unknown" });
  });
});

describe("payment_intent webhooks", () => {
  const object = (over: Record<string, unknown> = {}) => ({ id: "pi_testHook0001", object: "payment_intent", amount: 5000, application_fee_amount: 1250,
    transfer_data: { destination: ACCT }, latest_charge: "ch_testHook0001", last_payment_error: null, status: "succeeded",
    metadata: { payment_id: PAYMENT, visit_id: VISIT }, ...over });
  const ev = (type: string, o: Record<string, unknown>) => stripeEvent(type, o) as unknown as Stripe.Event;

  it("records a success, with when Stripe says it happened", async () => {
    const { results } = db([]);
    const event = ev("payment_intent.succeeded", object());
    await onPaymentIntentEvent(event);
    expect(results).toEqual([{ p_payment: PAYMENT, p_intent: "pi_testHook0001", p_outcome: "succeeded", p_amount: 5000, p_fee: 1250,
      p_destination: ACCT, p_charge: "ch_testHook0001", p_error: null, p_event_at: new Date(event.created * 1000).toISOString() }]);
  });

  it("a failed try is failed; one asking for the customer's bank confirmation waits for the customer", async () => {
    const { results } = db([]);
    await onPaymentIntentEvent(ev("payment_intent.payment_failed", object({ status: "requires_payment_method", last_payment_error: { code: "card_declined", decline_code: "insufficient_funds" } })));
    await onPaymentIntentEvent(ev("payment_intent.payment_failed", object({ status: "requires_payment_method", last_payment_error: { code: "authentication_required" } })));
    await onPaymentIntentEvent(ev("payment_intent.requires_action", object({ status: "requires_action" })));
    await onPaymentIntentEvent(ev("payment_intent.canceled", object({ status: "canceled" })));
    expect(results.map((r) => [r.p_outcome, r.p_error])).toEqual([["failed", "insufficient_funds"], ["requires_action", null], ["requires_action", null], ["failed", "canceled"]]);
  });

  it("ignores PaymentIntents that aren't Ping's charges", async () => {
    const { results } = db([]);
    await onPaymentIntentEvent(ev("payment_intent.succeeded", object({ metadata: {} })));
    await onPaymentIntentEvent(ev("payment_intent.succeeded", object({ metadata: { payment_id: "1; drop table payments" } })));
    await onPaymentIntentEvent(ev("payment_intent.succeeded", object({ id: "not-an-intent" })));
    expect(results).toEqual([]);
  });

  it("throws when the result can't be saved, so Stripe sends it again", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "08006" } });
    await expect(onPaymentIntentEvent(ev("payment_intent.succeeded", object()))).rejects.toThrow("couldn't record");
  });
});

describe("who may run the job", () => {
  const secret = "s".repeat(40);
  it("needs a secret of 32+ characters to be configured at all", () => {
    expect(jobSecret({})).toBeNull();
    expect(jobSecret({ PING_JOB_SECRET: "short" })).toBeNull();
    expect(jobSecret({ PING_JOB_SECRET: secret })).toBe(secret);
  });
  it("lets in only the exact secret", () => {
    expect(jobRequestAllowed(`Bearer ${secret}`, secret)).toBe(true);
    for (const header of [null, "", "Bearer ", `Bearer ${secret}x`, `bearer ${secret}`, secret, `Basic ${secret}`]) {
      expect({ header, ok: jobRequestAllowed(header, secret) }).toEqual({ header, ok: false });
    }
  });
});
