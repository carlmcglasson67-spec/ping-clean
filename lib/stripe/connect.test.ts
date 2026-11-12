// Cleaners' payments set-up (payments PR 5), with the real Stripe library talking to the local fake Stripe.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeStripe, TEST_SECRET_KEY, type FakeStripe } from "../../tests/stripe/fake-stripe.mjs";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
vi.mock("@/lib/db/admin", () => ({ createAdminClient: () => ({ rpc }) }));
const session = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSession: () => session() }));
const cleanerRow = vi.fn();
vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: cleanerRow() }) }) }) }) }),
}));

const PORT = 12_900 + Math.floor(Math.random() * 400);
let fake: FakeStripe;
const TARA = { userId: "00000000-0000-4000-a000-000000000004", role: "cleaner", email: "tara@example.com", fullName: "Tara Test", amr: [], sessionId: null };

beforeAll(async () => {
  fake = await startFakeStripe(PORT);
  vi.stubEnv("STRIPE_SECRET_KEY", TEST_SECRET_KEY);
  vi.stubEnv("STRIPE_API_BASE", fake.url);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-tests-0000000000");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pingclean.co.uk");
});
afterAll(async () => { vi.unstubAllEnvs(); await fake.stop(); });

const { refreshPaymentsStatus, startPaymentsSetup } = await import("./actions");
const { onAccountDeauthorized, onAccountUpdated, syncAccountStatus } = await import("./connect");

/** The database, as the RPCs behave: one account per cleaner, first wins. */
function fakeDb() {
  const links = new Map<string, string>();
  const statuses: Record<string, unknown>[] = [];
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "stripe_cleaner_account_for") return { data: links.get(args.p_cleaner as string) ?? null, error: null };
    if (fn === "stripe_link_cleaner_account") {
      if (!links.has(args.p_cleaner as string)) links.set(args.p_cleaner as string, args.p_account as string);
      return { data: links.get(args.p_cleaner as string), error: null };
    }
    if (fn === "stripe_account_status") {
      statuses.push(args);
      return { data: [...links.values()].includes(args.p_account as string) ? "updated" : "unknown_account", error: null };
    }
    return { data: null, error: { code: "XX000" } };
  });
  return { links, statuses };
}

describe("startPaymentsSetup (the cleaner app's Set up payments button)", () => {
  beforeEach(async () => {
    rpc.mockReset();
    await fetch(`${fake.url}/__test/reset`, { method: "POST" });
    session.mockReturnValue(TARA);
    cleanerRow.mockReturnValue({ status: "active" });
  });

  it("makes one GB Express account with manual payouts, then a link to Stripe's form that comes back to Ping", async () => {
    const { links } = fakeDb();
    const r = await startPaymentsSetup();
    expect(r).toMatchObject({ ok: true, url: expect.stringContaining("/__test/onboarding/acct_test") });
    const acct = [...fake.state.accounts.values()][0]!;
    expect(acct).toMatchObject({
      id: links.get(TARA.userId), type: "express", country: "GB", email: "tara@example.com", business_type: "individual",
      capabilities: { card_payments: "inactive", transfers: "inactive" },
      settings: { payouts: { schedule: { interval: "manual" } } }, // earnings wait for the dispute window
      metadata: { profile_id: TARA.userId },
      __return_url: "https://pingclean.co.uk/work/payments/return",
      __refresh_url: "https://pingclean.co.uk/work/payments/continue",
    });
    const [made, link] = fake.state.requests;
    expect([made!.path, made!.idempotencyKey]).toEqual(["/v1/accounts", `cleaner:${TARA.userId}:account`]);
    // Links are single use: a fresh one every time, never under a key of Ping's that would replay an old one.
    expect(link!.path).toBe("/v1/account_links");
    expect(link!.idempotencyKey ?? "").not.toContain(TARA.userId);
    expect(fake.state.requests).toHaveLength(2);
  });

  it("reuses the account on a second try, with a fresh link", async () => {
    fakeDb();
    const a = await startPaymentsSetup();
    const b = await startPaymentsSetup();
    expect(a.ok && b.ok).toBe(true);
    expect(fake.state.accounts.size).toBe(1);
    expect(fake.state.requests.filter((q) => q.path === "/v1/accounts")).toHaveLength(1);
    expect(fake.state.requests.filter((q) => q.path === "/v1/account_links")).toHaveLength(2);
  });

  it.each([
    ["signed out", () => session.mockReturnValue(null)],
    ["a customer", () => session.mockReturnValue({ ...TARA, role: "customer" })],
    ["an applicant", () => cleanerRow.mockReturnValue({ status: "applicant" })],
    ["a suspended cleaner", () => cleanerRow.mockReturnValue({ status: "suspended" })],
  ])("refuses %s, and calls Stripe for nothing", async (_why, setup) => {
    fakeDb();
    setup();
    expect(await startPaymentsSetup()).toMatchObject({ ok: false, error: expect.stringMatching(/approved/) });
    expect(fake.state.requests).toEqual([]);
  });

  it("says set-up isn't on yet without a Stripe test key, and never starts with a live one", async () => {
    fakeDb();
    for (const key of ["", "sk_live_" + "a".repeat(24)]) {
      vi.stubEnv("STRIPE_SECRET_KEY", key);
      expect(await startPaymentsSetup()).toMatchObject({ ok: false, error: expect.stringMatching(/isn't switched on/) });
    }
    vi.stubEnv("STRIPE_SECRET_KEY", TEST_SECRET_KEY);
    expect(fake.state.requests).toEqual([]);
  });

  it("gives a plain message, with nothing personal logged, when Stripe is down", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await startPaymentsSetup()).toMatchObject({ ok: false, error: expect.stringMatching(/try again/) });
    expect(JSON.stringify(err.mock.calls)).not.toMatch(/tara@example\.com|00000000-0000-4000/);
    err.mockRestore();
  });
});

describe("what Stripe says the account can do", () => {
  beforeEach(async () => {
    rpc.mockReset();
    await fetch(`${fake.url}/__test/reset`, { method: "POST" });
    session.mockReturnValue(TARA);
    cleanerRow.mockReturnValue({ status: "active" });
  });
  const event = (type: string, account: string | undefined, object: Record<string, unknown>) => ({ id: "evt_test_acct0001", type, account, data: { object } }) as never;
  const set = (id: string, body: Record<string, unknown>) => fetch(`${fake.url}/__test/accounts/${id}`, { method: "POST", body: JSON.stringify(body) });

  it("account.updated reads the account from Stripe itself, not from the event's copy", async () => {
    const { links, statuses } = fakeDb();
    await startPaymentsSetup();
    const id = links.get(TARA.userId)!;
    // The event claims everything is enabled; Stripe says the form isn't finished.
    await onAccountUpdated(event("account.updated", id, { id, charges_enabled: true, payouts_enabled: true, details_submitted: true }));
    expect(statuses.at(-1)).toEqual({ p_account: id, p_charges_enabled: false, p_payouts_enabled: false, p_details_submitted: false, p_requirements_due: true });

    await set(id, { charges_enabled: true, payouts_enabled: true, details_submitted: true, currently_due: [] });
    await onAccountUpdated(event("account.updated", id, { id }));
    expect(statuses.at(-1)).toEqual({ p_account: id, p_charges_enabled: true, p_payouts_enabled: true, p_details_submitted: true, p_requirements_due: false });
  });

  it("counts something past due as still needed, even once the form is in", async () => {
    const { links, statuses } = fakeDb();
    await startPaymentsSetup();
    const id = links.get(TARA.userId)!;
    await set(id, { details_submitted: true, currently_due: [], past_due: ["individual.verification.document"] });
    expect(await syncAccountStatus(id)).toBe("updated");
    expect(statuses.at(-1)).toMatchObject({ p_details_submitted: true, p_requirements_due: true, p_payouts_enabled: false });
  });

  it("ignores an event that doesn't name its own account, and an id that isn't an account", async () => {
    fakeDb();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await onAccountUpdated(event("account.updated", "acct_testOther0001", { id: "acct_testMine00001" }));
    await onAccountUpdated(event("account.updated", undefined, { id: "acct_testMine00001" }));
    expect(await syncAccountStatus("../v1/customers")).toBe("unknown_account");
    expect(rpc).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("an account Stripe says isn't Ping's stores nothing and isn't retried", async () => {
    fakeDb();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await onAccountUpdated(event("account.updated", "acct_testNotOurs0001", { id: "acct_testNotOurs0001" }));
    expect(rpc).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("asks Stripe to retry (throws) when the database can't save it", async () => {
    const { links } = fakeDb();
    await startPaymentsSetup();
    const id = links.get(TARA.userId)!;
    rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
    await expect(onAccountUpdated(event("account.updated", id, { id }))).rejects.toThrow(/couldn't save/);
  });

  it("a disconnected account is marked not ready at once", async () => {
    const { statuses } = fakeDb();
    await onAccountDeauthorized(event("account.application.deauthorized", "acct_testGone000001", { id: "ca_test" }));
    expect(statuses).toEqual([{ p_account: "acct_testGone000001", p_charges_enabled: false, p_payouts_enabled: false, p_details_submitted: false, p_requirements_due: true }]);
  });

  it("coming back from Stripe refreshes the cleaner's own account only", async () => {
    const { links, statuses } = fakeDb();
    await startPaymentsSetup();
    const id = links.get(TARA.userId)!;
    await set(id, { charges_enabled: true, payouts_enabled: true, details_submitted: true, currently_due: [] });
    await refreshPaymentsStatus();
    expect(statuses.at(-1)).toMatchObject({ p_account: id, p_charges_enabled: true, p_payouts_enabled: true });
    const before = statuses.length;
    session.mockReturnValue({ ...TARA, role: "customer" });
    await refreshPaymentsStatus();
    expect(statuses).toHaveLength(before);
  });
});
