// Paying cleaners (payments PR 9), with the real Stripe library talking to the local fake Stripe.
import type Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeStripe, stripeEvent, TEST_SECRET_KEY, type FakeStripe } from "../../tests/stripe/fake-stripe.mjs";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
vi.mock("@/lib/db/admin", () => ({ createAdminClient: () => ({ rpc }) }));

const PORT = 13_400 + Math.floor(Math.random() * 400);
let fake: FakeStripe;
const TARA = "00000000-0000-4000-a000-000000000004";
const ALEX = "00000000-0000-4000-a000-000000000005";
const ACCT = "acct_testTara000001";
const ACCT2 = "acct_testAlex000001";
const BATCH = "00000000-0000-4000-f100-0000000000aa";
const BATCH2 = "00000000-0000-4000-f100-0000000000bb";

beforeAll(async () => {
  fake = await startFakeStripe(PORT);
  vi.stubEnv("STRIPE_SECRET_KEY", TEST_SECRET_KEY);
  vi.stubEnv("STRIPE_API_BASE", fake.url);
});
afterAll(async () => { vi.unstubAllEnvs(); await fake.stop(); });

const { onPayoutEvent, readPayout, runPayoutJob } = await import("./payouts");

const cleared = (acct: string, available: number) => fetch(`${fake.url}/__test/balance/${acct}`, { method: "POST", body: JSON.stringify({ available }) });

/** The database's side: who is due, which batch it opens for what has cleared, and what the job reported. */
function db(opts: { due?: { cleaner_id: string; cleaner_account_id: string; due_pence: number }[]; open?: Record<string, unknown>[]; batchFor?: (cleaner: string, available: number) => Record<string, unknown> | null } = {}) {
  const calls: [string, Record<string, unknown>][] = [];
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push([fn, args]);
    if (fn === "refunds_open") return { data: [], error: null };
    if (fn === "payout_batches_open") return { data: opts.open ?? [], error: null };
    if (fn === "payout_due_cleaners") return { data: opts.due ?? [], error: null };
    if (fn === "payout_batch_open") { const b = opts.batchFor?.(args.p_cleaner as string, args.p_available_pence as number); return { data: b ? [b] : [], error: null }; }
    if (fn === "payout_batch_sent") return { data: "sent", error: null };
    if (fn === "payout_batch_not_sent") return { data: "returned", error: null };
    if (fn === "stripe_payout_result") return { data: args.p_outcome === "in_transit" ? "ignored" : args.p_outcome, error: null };
    return { data: null, error: { code: "XX000" } };
  });
  return { calls, of: (fn: string) => calls.filter((c) => c[0] === fn).map((c) => c[1]) };
}
const batch = (id = BATCH, acct = ACCT, amount = 3750) => ({ batch_id: id, cleaner_account_id: acct, amount_pence: amount, idempotency_key: `payout-batch:${id}` });

beforeEach(async () => {
  rpc.mockReset();
  await fetch(`${fake.url}/__test/reset`, { method: "POST" });
});

describe("the payout job", () => {
  it("asks Stripe what has cleared, then sends one bank payout from the cleaner's own account, keyed to the batch", async () => {
    await cleared(ACCT, 9000);
    const d = db({ due: [{ cleaner_id: TARA, cleaner_account_id: ACCT, due_pence: 3750 }], batchFor: () => batch() });
    const run = await runPayoutJob();
    expect(run).toEqual({ cleaners: 1, sent: 1, waiting: 0, paid: 0, failed: 0, errors: 0 });
    expect(d.of("payout_batch_open")).toEqual([{ p_cleaner: TARA, p_available_pence: 9000 }]);
    const po = [...fake.state.payouts.values()][0]!;
    expect(po).toMatchObject({ amount: 3750, currency: "gbp", metadata: { batch_id: BATCH }, __account: ACCT });
    expect(fake.state.requests).toEqual([
      { method: "GET", path: "/v1/balance", idempotencyKey: null, account: ACCT },
      { method: "POST", path: "/v1/payouts", idempotencyKey: `payout-batch:${BATCH}`, account: ACCT },
    ]);
    expect(d.of("payout_batch_sent")).toEqual([{ p_batch: BATCH, p_stripe_payout: po.id, p_arrival: expect.stringMatching(/^\d{4}-\d\d-\d\d$/) }]);
  });

  it("when nothing has cleared at Stripe yet, opens nothing and sends nothing: it waits", async () => {
    await cleared(ACCT, 0);
    const d = db({ due: [{ cleaner_id: TARA, cleaner_account_id: ACCT, due_pence: 3750 }], batchFor: () => batch() });
    expect(await runPayoutJob()).toMatchObject({ cleaners: 1, sent: 0, waiting: 1, errors: 0 });
    expect(d.of("payout_batch_open")).toEqual([]);
    expect(fake.state.payouts.size).toBe(0);
  });

  it("when the database finds nothing that fits what has cleared, sends nothing", async () => {
    await cleared(ACCT, 1000);
    db({ due: [{ cleaner_id: TARA, cleaner_account_id: ACCT, due_pence: 3750 }], batchFor: () => null });
    expect(await runPayoutJob()).toMatchObject({ sent: 0, waiting: 1 });
    expect(fake.state.payouts.size).toBe(0);
  });

  it("a request Stripe refuses hands the earnings back, and the next cleaner is still paid", async () => {
    await cleared(ACCT, 9000);
    await cleared(ACCT2, 9000);
    const d = db({
      due: [{ cleaner_id: TARA, cleaner_account_id: ACCT, due_pence: 3750 }, { cleaner_id: ALEX, cleaner_account_id: ACCT2, due_pence: 3750 }],
      batchFor: (c) => (c === TARA ? batch(BATCH, ACCT, 99_999) : batch(BATCH2, ACCT2)), // more than Tara's balance: Stripe says no
    });
    const run = await runPayoutJob();
    expect(run).toMatchObject({ cleaners: 2, sent: 1, waiting: 1, errors: 0 });
    expect(d.of("payout_batch_not_sent")).toEqual([{ p_batch: BATCH, p_error: "stripe_balance_insufficient" }]);
    expect([...fake.state.payouts.values()].map((p) => p.__account)).toEqual([ACCT2]);
  });

  it("when Stripe can't be reached, leaves the batch for the next run and carries on", async () => {
    await cleared(ACCT2, 9000);
    const d = db({
      due: [{ cleaner_id: TARA, cleaner_account_id: "acct_testNoSuchOne01", due_pence: 3750 }, { cleaner_id: ALEX, cleaner_account_id: ACCT2, due_pence: 3750 }],
      batchFor: (c) => (c === ALEX ? batch(BATCH2, ACCT2) : null),
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = await runPayoutJob();
    expect(run.sent).toBe(1);
    expect(d.of("payout_batch_not_sent")).toEqual([]);
    err.mockRestore();
  });

  it("sends again a batch that never reached Stripe, with the same key: one payout however often", async () => {
    await cleared(ACCT, 9000);
    db({ open: [{ ...batch(), mode: "send", stripe_payout_id: null }] });
    await runPayoutJob();
    await runPayoutJob();
    expect(fake.state.payouts.size).toBe(1);
    expect(fake.state.requests.filter((r) => r.path === "/v1/payouts").map((r) => r.idempotencyKey)).toEqual([`payout-batch:${BATCH}`, `payout-batch:${BATCH}`]);
  });

  it("asks Stripe about a payout it hasn't heard back on, and records the bank's answer", async () => {
    await cleared(ACCT, 9000);
    db({ open: [{ ...batch(), mode: "send", stripe_payout_id: null }] });
    await runPayoutJob();
    const po = [...fake.state.payouts.values()][0]!;

    const transit = db({ open: [{ ...batch(), mode: "check", stripe_payout_id: po.id }] });
    expect(await runPayoutJob()).toMatchObject({ paid: 0, failed: 0 });
    expect(transit.of("stripe_payout_result")[0]).toMatchObject({ p_batch: BATCH, p_stripe_payout: po.id, p_account: ACCT, p_outcome: "in_transit", p_amount: 3750 });

    await fetch(`${fake.url}/__test/payouts/${po.id}`, { method: "POST", body: JSON.stringify({ status: "failed", failure_code: "account_closed" }) });
    const failed = db({ open: [{ ...batch(), mode: "check", stripe_payout_id: po.id }] });
    expect(await runPayoutJob()).toMatchObject({ failed: 1 });
    expect(failed.of("stripe_payout_result")[0]).toMatchObject({ p_outcome: "failed", p_error: "account_closed" });
  });

  it("stops with an error when the database can't say who is due", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runPayoutJob()).rejects.toThrow(/couldn't read/);
    err.mockRestore();
  });
});

describe("reading a payout", () => {
  const po = (o: Record<string, unknown>) => ({ id: "po_testRead000001", amount: 3750, ...o }) as unknown as Stripe.Payout;
  it("paid, failed with Stripe's code, cancelled, and everything else is still on its way", () => {
    expect(readPayout(po({ status: "paid" }))).toEqual({ outcome: "paid", error: null });
    expect(readPayout(po({ status: "failed", failure_code: "account_closed" }))).toEqual({ outcome: "failed", error: "account_closed" });
    expect(readPayout(po({ status: "failed", failure_code: "Free text: call 0800…" }))).toEqual({ outcome: "failed", error: "payout_failed" });
    expect(readPayout(po({ status: "canceled" }))).toEqual({ outcome: "failed", error: "canceled" });
    expect(readPayout(po({ status: "in_transit" }))).toEqual({ outcome: "in_transit", error: null });
    expect(readPayout(po({ status: "pending" }))).toEqual({ outcome: "in_transit", error: null });
  });
});

describe("payout webhooks (Connect)", () => {
  const object = (over: Record<string, unknown> = {}) => ({ id: "po_testHook000001", object: "payout", amount: 3750, currency: "gbp", status: "in_transit",
    arrival_date: 1_794_528_000, failure_code: null, metadata: { batch_id: BATCH }, ...over });
  const ev = (type: string, o: Record<string, unknown>, account: string | null = ACCT) => stripeEvent(type, o, account ? { account } : {}) as unknown as Stripe.Event;

  it("payout.paid records paid for the batch named in the payout, with the account from the signed event", async () => {
    const d = db();
    await onPayoutEvent(ev("payout.paid", object()));
    expect(d.of("stripe_payout_result")).toEqual([{ p_batch: BATCH, p_stripe_payout: "po_testHook000001", p_account: ACCT, p_outcome: "paid", p_amount: 3750, p_arrival: "2026-11-13", p_error: null }]);
  });

  it("payout.failed records the bank's reason", async () => {
    const d = db();
    await onPayoutEvent(ev("payout.failed", object({ status: "failed", failure_code: "no_account" })));
    expect(d.of("stripe_payout_result")[0]).toMatchObject({ p_outcome: "failed", p_error: "no_account" });
  });

  it("ignores payouts that aren't Ping's: no batch, a made-up batch id, or no account on the event", async () => {
    const d = db();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await onPayoutEvent(ev("payout.paid", object({ metadata: {} })));
    await onPayoutEvent(ev("payout.paid", object({ metadata: { batch_id: "1 or 1=1" } })));
    await onPayoutEvent(ev("payout.paid", object(), null));
    expect(d.calls).toEqual([]);
    warn.mockRestore();
  });

  it("asks Stripe to retry (throws) when the database can't save it", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
    await expect(onPayoutEvent(ev("payout.paid", object()))).rejects.toThrow(/couldn't record/);
  });
});
