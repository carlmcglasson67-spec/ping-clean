// Card saving (payments PR 4), with the real Stripe library talking to the local fake Stripe.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeStripe, TEST_PUBLISHABLE_KEY, TEST_SECRET_KEY, type FakeStripe } from "../../tests/stripe/fake-stripe.mjs";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
vi.mock("@/lib/db/admin", () => ({ createAdminClient: () => ({ rpc }) }));
const session = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSession: () => session() }));
const seriesRow = vi.fn();
vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: seriesRow() }) }) }) }) }),
}));

const PORT = 12_400 + Math.floor(Math.random() * 400);
let fake: FakeStripe;
const SERIES = "00000000-0000-4000-c000-000000000001";
const ANNA = { userId: "00000000-0000-4000-a000-000000000002", role: "customer", email: "anna@example.com", fullName: "Anna Test", amr: [], sessionId: null };

beforeAll(async () => {
  fake = await startFakeStripe(PORT);
  vi.stubEnv("STRIPE_SECRET_KEY", TEST_SECRET_KEY);
  vi.stubEnv("STRIPE_API_BASE", fake.url);
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", TEST_PUBLISHABLE_KEY);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-tests-0000000000");
});
afterAll(async () => { vi.unstubAllEnvs(); await fake.stop(); });

const { startCardSetup } = await import("./actions");
const { onSetupIntentSucceeded } = await import("./cards");

/** The database, as the RPCs behave: one customer link per profile. */
function fakeDb() {
  const links = new Map<string, string>();
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "stripe_customer_for") return { data: links.get(args.p_profile as string) ?? null, error: null };
    if (fn === "stripe_link_customer") {
      if (!links.has(args.p_profile as string)) links.set(args.p_profile as string, args.p_stripe_customer as string);
      return { data: links.get(args.p_profile as string), error: null };
    }
    if (fn === "stripe_card_saved") return { data: "saved", error: null };
    return { data: null, error: { code: "XX000" } };
  });
  return links;
}

describe("startCardSetup (the Server Action for checkout's card step)", () => {
  beforeEach(() => {
    rpc.mockReset();
    fake.state.requests.length = 0;
    session.mockReturnValue(ANNA);
    seriesRow.mockReturnValue({ id: SERIES, status: "offering" });
  });

  it("makes one Stripe customer, then a SetupIntent for the block, and returns what the card form needs", async () => {
    const links = fakeDb();
    const r = await startCardSetup(SERIES);
    expect(r).toMatchObject({ ok: true, publishableKey: TEST_PUBLISHABLE_KEY });
    if (!r.ok) return;
    expect(r.clientSecret).toMatch(/^seti_test[0-9a-f]+_secret_/);
    const si = [...fake.state.setupIntents.values()][0]!;
    expect(si).toMatchObject({ customer: links.get(ANNA.userId), usage: "off_session", metadata: { series_id: SERIES, profile_id: ANNA.userId } });
    expect(fake.state.requests.map((q) => [q.path, q.idempotencyKey])).toEqual([
      ["/v1/customers", `profile:${ANNA.userId}:customer`],
      ["/v1/setup_intents", `series:${SERIES}:setup`],
    ]);
  });

  it("reuses the customer and the SetupIntent on a second try (double click, refresh)", async () => {
    fakeDb();
    const a = await startCardSetup(SERIES);
    const b = await startCardSetup(SERIES);
    expect(a.ok && b.ok && a.clientSecret === b.clientSecret).toBe(true);
    expect(fake.state.requests.filter((q) => q.path === "/v1/customers")).toHaveLength(1);
  });

  it.each([
    ["a made-up id", () => {}, "not-a-uuid", /try again/],
    ["signed out", () => session.mockReturnValue(null), SERIES, /Sign in/],
    ["a cleaner", () => session.mockReturnValue({ ...ANNA, role: "cleaner" }), SERIES, /Sign in/],
    ["someone else's block (RLS returns nothing)", () => seriesRow.mockReturnValue(null), SERIES, /isn't open/],
    ["an ended block", () => seriesRow.mockReturnValue({ id: SERIES, status: "ended" }), SERIES, /isn't open/],
  ])("refuses %s, and calls Stripe for nothing", async (_why, setup, id, message) => {
    fakeDb();
    setup();
    const r = await startCardSetup(id);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(message) });
    expect(fake.state.requests).toEqual([]);
  });

  it("says card saving isn't on yet when Stripe isn't configured with test keys", async () => {
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "");
    expect(await startCardSetup(SERIES)).toMatchObject({ ok: false, error: expect.stringMatching(/isn't switched on/) });
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", TEST_PUBLISHABLE_KEY);
  });
});

describe("setup_intent.succeeded (the webhook that saves the card)", () => {
  const event = (si: Record<string, unknown>) => ({ id: "evt_test_card0001", type: "setup_intent.succeeded", data: { object: si } }) as never;
  const pm = async (customer: string | null) => {
    const r = await fetch(`${fake.url}/__test/payment_methods`, { method: "POST", body: JSON.stringify({ customer, brand: "visa", last4: "4242", exp_month: 11, exp_year: 2031 }) });
    return (await r.json()).id as string;
  };
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: "saved", error: null }); });

  it("saves the card's brand, last four and expiry, after checking the card belongs to that customer at Stripe", async () => {
    const id = await pm("cus_testAnna0001");
    await onSetupIntentSucceeded(event({ status: "succeeded", customer: "cus_testAnna0001", payment_method: id, metadata: { series_id: SERIES } }));
    expect(rpc).toHaveBeenCalledWith("stripe_card_saved", {
      p_series: SERIES, p_stripe_customer: "cus_testAnna0001", p_payment_method: id,
      p_brand: "visa", p_last4: "4242", p_exp_month: 11, p_exp_year: 2031,
    });
  });

  it("stores nothing when the card isn't attached to that customer, or the event is incomplete", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const elsewhere = await pm("cus_testSomeoneElse");
    await onSetupIntentSucceeded(event({ status: "succeeded", customer: "cus_testAnna0001", payment_method: elsewhere, metadata: { series_id: SERIES } }));
    await onSetupIntentSucceeded(event({ status: "succeeded", customer: "cus_testAnna0001", payment_method: elsewhere, metadata: {} }));
    await onSetupIntentSucceeded(event({ status: "succeeded", customer: "cus_testAnna0001", payment_method: elsewhere, metadata: { series_id: "x" } }));
    await onSetupIntentSucceeded(event({ status: "processing", customer: "cus_testAnna0001", payment_method: elsewhere, metadata: { series_id: SERIES } }));
    expect(rpc).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("asks Stripe to retry (throws) when the database can't save it", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
    const id = await pm("cus_testAnna0001");
    await expect(onSetupIntentSucceeded(event({ status: "succeeded", customer: "cus_testAnna0001", payment_method: id, metadata: { series_id: SERIES } })))
      .rejects.toThrow(/couldn't save/);
  });
});
