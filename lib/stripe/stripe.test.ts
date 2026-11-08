import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
vi.mock("@/lib/db/admin", () => ({ createAdminClient: () => ({ rpc }) }));

const { apiBase, publishableKey, secretKeyProblem, webhookSecret } = await import("./keys");
const { verifyStripeEvent, MAX_WEBHOOK_BYTES } = await import("./webhooks");
const { HANDLERS, receiveStripeWebhook } = await import("./receive");

const SECRET = "whsec_unitTestSigningSecret0000";
// Live-shaped keys, built from parts so no live key ever appears in the source (check-secrets).
const LIVE = "_live_" + "abcdefghijklmnop";
const LIVE_SK = "sk" + LIVE, LIVE_RK = "rk" + LIVE, LIVE_PK = "pk" + LIVE;
const sign = (body: string, timestamp?: number, secret = SECRET) =>
  Stripe.webhooks.generateTestHeaderString({ payload: body, secret, timestamp });
const event = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ id: "evt_test_unit0001", object: "event", type: "payment_intent.succeeded", livemode: false,
    created: 1, data: { object: { id: "pi_test_x", receipt_email: "anna@example.com" } }, ...over });

describe("keys: test mode only", () => {
  it("accepts only Stripe test secret keys, and never repeats the key in the message", () => {
    expect(secretKeyProblem("sk_test_abcdefghijklmnop")).toBeNull();
    expect(secretKeyProblem("rk_test_abcdefghijklmnop")).toBeNull();
    for (const k of [undefined, "", LIVE_SK, LIVE_RK, "pk_test_abcdefghijklmnop", "sk_test_short", "nonsense"]) {
      const p = secretKeyProblem(k);
      expect(p).not.toBeNull();
      if (k) expect(p).not.toContain(k);
    }
    expect(secretKeyProblem(LIVE_SK)).toMatch(/LIVE key/);
  });

  it("gives the browser a publishable key only if it's a test one", () => {
    expect(publishableKey({ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_abcdefghijklmnop" })).toBe("pk_test_abcdefghijklmnop");
    expect(publishableKey({ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: LIVE_PK })).toBeNull();
    expect(publishableKey({})).toBeNull();
  });

  it("only takes webhook secrets shaped like Stripe's", () => {
    expect(webhookSecret("STRIPE_WEBHOOK_SECRET", { STRIPE_WEBHOOK_SECRET: SECRET })).toBe(SECRET);
    expect(webhookSecret("STRIPE_WEBHOOK_SECRET", { STRIPE_WEBHOOK_SECRET: "secret" })).toBeNull();
    expect(webhookSecret("STRIPE_CONNECT_WEBHOOK_SECRET", {})).toBeNull();
  });

  it("sends Stripe requests to a test fake only on this machine", () => {
    expect(apiBase({})).toBeNull();
    expect(apiBase({ STRIPE_API_BASE: "http://127.0.0.1:12111" })).toEqual({ host: "127.0.0.1", port: 12111, protocol: "http" });
    expect(() => apiBase({ STRIPE_API_BASE: "https://evil.example" })).toThrow(/this machine/);
    expect(() => apiBase({ STRIPE_API_BASE: "ftp://127.0.0.1" })).toThrow(/this machine/);
    expect(() => apiBase({ STRIPE_API_BASE: "not a url" })).toThrow(/isn't a URL/);
  });

  it("the Stripe client refuses to start with a live key", async () => {
    vi.resetModules();
    vi.stubEnv("STRIPE_SECRET_KEY", LIVE_SK);
    const { getStripe } = await import("./server");
    expect(() => getStripe()).toThrow(/LIVE key/);
    vi.resetModules();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abcdefghijklmnop");
    vi.stubEnv("STRIPE_API_BASE", "http://127.0.0.1:12111");
    const fresh = await import("./server");
    expect(fresh.getStripe()).toBeInstanceOf(Stripe);
    vi.unstubAllEnvs();
  });
});

describe("verifyStripeEvent", () => {
  const now = Date.now();
  it("accepts a correctly signed test-mode platform event", () => {
    const body = event();
    const r = verifyStripeEvent(body, sign(body), SECRET, "platform");
    expect(r.ok && r.event.id).toBe("evt_test_unit0001");
  });

  it.each([
    ["no signature", (b: string) => [b, null]],
    ["the wrong secret", (b: string) => [b, sign(b, undefined, "whsec_someoneElsesSecret0000")]],
    ["a changed body", (b: string) => [b.replace("pi_test_x", "pi_test_y"), sign(b)]],
    ["a signature older than 5 minutes (a replayed request)", (b: string) => [b, sign(b, Math.floor(now / 1000) - 301)]],
  ])("refuses %s", (_why, make) => {
    const [body, sig] = make(event()) as [string, string | null];
    const r = verifyStripeEvent(body, sig, SECRET, "platform", now);
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses live-mode events, odd ids and oversized bodies", () => {
    for (const body of [event({ livemode: true }), event({ id: "nope" })]) {
      expect(verifyStripeEvent(body, sign(body), SECRET, "platform")).toMatchObject({ ok: false, status: 400 });
    }
    const big = event({ padding: "x".repeat(MAX_WEBHOOK_BYTES) });
    expect(verifyStripeEvent(big, sign(big), SECRET, "platform")).toMatchObject({ ok: false, status: 413 });
  });

  it("keeps Connect events and platform events on their own endpoints", () => {
    const connect = event({ account: "acct_testCleaner01" });
    expect(verifyStripeEvent(connect, sign(connect), SECRET, "connect").ok).toBe(true);
    expect(verifyStripeEvent(connect, sign(connect), SECRET, "platform")).toMatchObject({ ok: false, error: "connect event on platform endpoint" });
    const platform = event();
    expect(verifyStripeEvent(platform, sign(platform), SECRET, "connect")).toMatchObject({ ok: false, error: "platform event on connect endpoint" });
    const odd = event({ account: "acct_<script>" });
    expect(verifyStripeEvent(odd, sign(odd), SECRET, "connect").ok).toBe(false);
  });
});

describe("receiveStripeWebhook", () => {
  const post = (body: string, headers: Record<string, string> = { "stripe-signature": sign(body) }) =>
    new Request("http://127.0.0.1/api/stripe/webhook", { method: "POST", body, headers });

  beforeEach(() => {
    rpc.mockReset();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
    HANDLERS.platform = {};
  });

  it("answers 503 when the endpoint's secret isn't set, so Stripe tries again later", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await receiveStripeWebhook(post(event()), "platform")).status).toBe(503);
    err.mockRestore();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a bad signature before touching the database", async () => {
    const res = await receiveStripeWebhook(post(event(), { "stripe-signature": "t=1,v1=00" }), "platform");
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records a new event, runs its handler once, and marks it handled", async () => {
    rpc.mockResolvedValueOnce({ data: "process", error: null }).mockResolvedValueOnce({ data: null, error: null });
    const handler = vi.fn(async () => {});
    HANDLERS.platform["payment_intent.succeeded"] = handler;
    const res = await receiveStripeWebhook(post(event()), "platform");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, handled: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls).toEqual([
      ["stripe_begin_event", { p_event_id: "evt_test_unit0001", p_type: "payment_intent.succeeded", p_account: null }],
      ["stripe_finish_event", { p_event_id: "evt_test_unit0001", p_error: null }],
    ]);
  });

  it("acknowledges a replay without running anything again", async () => {
    rpc.mockResolvedValueOnce({ data: "done", error: null });
    const handler = vi.fn(async () => {});
    HANDLERS.platform["payment_intent.succeeded"] = handler;
    const res = await receiveStripeWebhook(post(event()), "platform");
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(handler).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("records a failed handler and answers 500 so Stripe retries, logging no personal data", async () => {
    rpc.mockResolvedValueOnce({ data: "process", error: null }).mockResolvedValueOnce({ data: null, error: null });
    HANDLERS.platform["payment_intent.succeeded"] = async () => { throw new Error("database busy"); };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await receiveStripeWebhook(post(event()), "platform");
    expect(res.status).toBe(500);
    expect(rpc.mock.calls[1]).toEqual(["stripe_finish_event", { p_event_id: "evt_test_unit0001", p_error: "database busy" }]);
    expect(JSON.stringify(err.mock.calls)).not.toContain("anna@example.com");
    err.mockRestore();
  });

  it("acknowledges event types with no handler yet (recorded, nothing to do)", async () => {
    rpc.mockResolvedValueOnce({ data: "process", error: null }).mockResolvedValueOnce({ data: null, error: null });
    const res = await receiveStripeWebhook(post(event({ type: "customer.created" })), "platform");
    expect(await res.json()).toEqual({ received: true, handled: false });
  });
});
