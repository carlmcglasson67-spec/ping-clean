// "Pay now", the bank's confirmation step and changing card (payments PR 8), with the real
// Stripe library talking to the local fake Stripe. The database is stood in for by its calls.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeStripe, TEST_SECRET_KEY, type FakeStripe } from "../../tests/stripe/fake-stripe.mjs";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
vi.mock("@/lib/db/admin", () => ({ createAdminClient: () => ({ rpc }) }));

const PORT = 13_400 + Math.floor(Math.random() * 400);
let fake: FakeStripe;
beforeAll(async () => {
  fake = await startFakeStripe(PORT);
  vi.stubEnv("STRIPE_SECRET_KEY", TEST_SECRET_KEY);
  vi.stubEnv("STRIPE_API_BASE", fake.url);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-tests-0000000000");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await fake.stop(); });

const { checkPayment, confirmCardChange, declineReason, payNow, startCardChange } = await import("./pay");

const PAYMENT = "00000000-0000-4000-f000-0000000000aa";
const ANNA = "00000000-0000-4000-a000-000000000002";
const SERIES = "00000000-0000-4000-c000-000000000001";
const ACCT = "acct_testCleaner0001";
const CUS = "cus_testAnna000001";
const row = (over: Record<string, unknown> = {}) => ({
  problem: null, payment_id: PAYMENT, mode: "create", visit_id: "00000000-0000-4000-e000-000000000002", amount_pence: 5000,
  application_fee_pence: 1250, stripe_customer_id: CUS, payment_method_id: "pm_testCard000001", cleaner_account_id: ACCT,
  payment_intent_id: null, attempt: 3, idempotency_key: `payment:${PAYMENT}`, ...over,
});
const card = (behaviour: "ok" | "decline" | "auth") =>
  fetch(`${fake.url}/__test/payment_methods`, { method: "POST", body: JSON.stringify({ id: "pm_testCard000001", customer: CUS, behaviour }) });

/** The database: `begin` is what customer_pay_begin answers; results are remembered. */
function db(begin: ReturnType<typeof row> | null, answer: (a: Record<string, unknown>) => string = (a) => (a.p_outcome === "processing" ? "ignored" : (a.p_outcome as string))) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let intent: string | null = null;
  let linked: string | null = null; // Anna's Stripe customer, made the first time it's needed
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (fn === "customer_pay_begin") return { data: begin ? [begin] : [], error: null };
    if (fn === "stripe_payment_result") { intent = args.p_intent as string; return { data: answer(args), error: null }; }
    if (fn === "customer_payment_intent") return { data: intent, error: null };
    if (fn === "charge_not_sent") return { data: "failed", error: null };
    if (fn === "customer_card_series") return { data: args.p_customer === ANNA ? SERIES : null, error: null };
    if (fn === "stripe_customer_for") return { data: args.p_profile === ANNA ? linked : null, error: null };
    if (fn === "stripe_link_customer") { linked = args.p_stripe_customer as string; return { data: linked, error: null }; }
    if (fn === "stripe_card_saved") return { data: "saved", error: null };
    return { data: null, error: { code: "XX000" } };
  });
  return { calls, results: () => calls.filter((c) => c.fn === "stripe_payment_result").map((c) => c.args) };
}

beforeEach(async () => { rpc.mockReset(); await fetch(`${fake.url}/__test/reset`, { method: "POST" }); });

describe("pay now", () => {
  it("charges the saved card with the customer present, and records Stripe's answer", async () => {
    await card("ok");
    const d = db(row());
    expect(await payNow(PAYMENT, ANNA)).toEqual({ state: "paid" });
    expect(d.calls[0]).toEqual({ fn: "customer_pay_begin", args: { p_payment: PAYMENT, p_customer: ANNA } });
    const [pi] = [...fake.state.paymentIntents.values()];
    expect(pi).toMatchObject({ amount: 5000, application_fee_amount: 1250, on_behalf_of: ACCT, status: "succeeded", __present: true });
    expect(d.results()).toEqual([expect.objectContaining({ p_payment: PAYMENT, p_outcome: "succeeded", p_amount: 5000, p_fee: 1250, p_destination: ACCT })]);
  });

  it("says why when the bank declines, in plain words, and nothing is taken", async () => {
    await card("decline");
    const d = db(row());
    expect(await payNow(PAYMENT, ANNA)).toEqual({ state: "declined", reason: "Your bank said there wasn't enough money on that card." });
    expect(d.results()[0]).toMatchObject({ p_outcome: "failed", p_error: "insufficient_funds" });
    expect([...fake.state.paymentIntents.values()][0]!.status).toBe("requires_payment_method");
  });

  it("hands over to the bank's step without recording a failure, then records how it ended", async () => {
    await card("auth");
    const d = db(row());
    const first = await payNow(PAYMENT, ANNA);
    expect(first).toEqual({ state: "needs_bank", clientSecret: expect.stringMatching(/^pi_.+_secret_/) });
    expect(d.results().map((r) => r.p_outcome)).toEqual(["processing"]); // only notes which PaymentIntent it is

    const [pi] = [...fake.state.paymentIntents.values()];
    expect(await checkPayment(PAYMENT, ANNA)).toMatchObject({ state: "needs_bank" }); // not done yet
    await fetch(`${fake.url}/__test/payment_intents/${pi!.id}/bank`, { method: "POST", body: "{}" }); // they confirm
    expect(await checkPayment(PAYMENT, ANNA)).toEqual({ state: "paid" });
    expect(d.results().at(-1)).toMatchObject({ p_intent: pi!.id, p_outcome: "succeeded" });
  });

  it("a failed bank step is a decline", async () => {
    await card("auth");
    db(row());
    await payNow(PAYMENT, ANNA);
    const [pi] = [...fake.state.paymentIntents.values()];
    await fetch(`${fake.url}/__test/payment_intents/${pi!.id}/bank`, { method: "POST", body: JSON.stringify({ ok: false }) });
    expect(await checkPayment(PAYMENT, ANNA)).toEqual({ state: "declined", reason: "Your bank couldn't confirm it was you." });
  });

  it("a retry confirms the same PaymentIntent with the customer present", async () => {
    await card("decline");
    db(row());
    await payNow(PAYMENT, ANNA);
    const [pi] = [...fake.state.paymentIntents.values()];
    await card("ok");
    db(row({ mode: "retry", payment_intent_id: pi!.id, attempt: 4 }));
    expect(await payNow(PAYMENT, ANNA)).toEqual({ state: "paid" });
    expect(fake.state.paymentIntents.size).toBe(1);
    expect(fake.state.requests.at(-1)).toEqual({ method: "POST", path: `/v1/payment_intents/${pi!.id}/confirm`, idempotencyKey: `payment:${PAYMENT}:confirm:4` });
  });

  it("never reaches Stripe when the database says no", async () => {
    for (const [problem, state] of [["already_paid", "paid"], ["in_progress", "in_progress"], ["no_card", "no_card"], ["not_found", "unavailable"], ["not_ready", "unavailable"], ["too_many", "unavailable"]] as const) {
      db(row({ problem }));
      expect({ problem, r: await payNow(PAYMENT, ANNA) }).toEqual({ problem, r: { state } });
    }
    db(null);
    expect(await payNow(PAYMENT, ANNA)).toEqual({ state: "unavailable" });
    expect(fake.state.requests).toEqual([]);
  });

  it("is unavailable, not paid, when Stripe's answer doesn't match the row", async () => {
    await card("ok");
    db(row(), () => "mismatch");
    expect(await payNow(PAYMENT, ANNA)).toEqual({ state: "unavailable" });
  });

  it("never shows the bank's raw code", () => {
    for (const code of ["insufficient_funds", "expired_card", "stolen_card", "incorrect_cvc", "do_not_honor", null, "<script>"]) {
      expect(declineReason(code)).toMatch(/^[A-Za-z' .]+\.$/); // words only: no codes, no markup
    }
  });
});

describe("using a different card", () => {
  it("opens a fresh card form for the payment's own block", async () => {
    const d = db(row());
    const secret = await startCardChange(PAYMENT, { id: ANNA, email: "anna@example.com", fullName: "Anna Test" });
    expect(secret).toMatch(/^seti_.+_secret_/);
    const [si] = [...fake.state.setupIntents.values()];
    expect(si).toMatchObject({ usage: "off_session", metadata: { series_id: SERIES, profile_id: ANNA } });
    expect(d.calls[0]).toEqual({ fn: "customer_card_series", args: { p_payment: PAYMENT, p_customer: ANNA } });
    expect(await startCardChange(PAYMENT, { id: "00000000-0000-4000-a000-000000000003", email: null, fullName: null })).toBeNull(); // not their payment
  });

  it("stores the new card only when Stripe says that customer saved it", async () => {
    const d = db(row());
    await startCardChange(PAYMENT, { id: ANNA, email: null, fullName: null });
    const [si] = [...fake.state.setupIntents.values()] as { id: string; customer: string }[];
    const stripeCustomer = si!.customer;
    rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
      d.calls.push({ fn, args });
      if (fn === "stripe_customer_for") return { data: args.p_profile === ANNA ? stripeCustomer : "cus_testSomeoneElse", error: null };
      if (fn === "stripe_card_saved") return { data: "saved", error: null };
      return { data: null, error: { code: "XX000" } };
    });
    expect(await confirmCardChange(si!.id, ANNA)).toBe(false); // not finished at Stripe yet

    const pm = await (await fetch(`${fake.url}/__test/payment_methods`, { method: "POST", body: JSON.stringify({ customer: stripeCustomer, last4: "4444" }) })).json();
    await fetch(`${fake.url}/__test/setup_intents/${si!.id}`, { method: "POST", body: JSON.stringify({ status: "succeeded", payment_method: pm.id }) });
    expect(await confirmCardChange(si!.id, "00000000-0000-4000-a000-000000000003")).toBe(false); // someone else's SetupIntent
    expect(await confirmCardChange("seti_doesNotExist01", ANNA)).toBe(false);
    expect(await confirmCardChange("'; drop table", ANNA)).toBe(false);
    expect(d.calls.filter((c) => c.fn === "stripe_card_saved")).toEqual([]);

    expect(await confirmCardChange(si!.id, ANNA)).toBe(true);
    expect(d.calls.filter((c) => c.fn === "stripe_card_saved").map((c) => c.args)).toEqual([
      expect.objectContaining({ p_series: SERIES, p_stripe_customer: stripeCustomer, p_payment_method: pm.id, p_last4: "4444" }),
    ]);
  });
});
