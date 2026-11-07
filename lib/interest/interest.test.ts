import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
vi.mock("@/lib/db/server", () => ({ createClient: async () => ({ rpc }) }));

const { normaliseEmail, normalisePostcode, normaliseUkMobile, parseInterestForm, INTEREST_CONSENT_VERSION, initialInterestState } =
  await import("./form");
const { turnstileEnabled, turnstileSiteKey, verifyTurnstile } = await import("./turnstile");
const { registerInterest } = await import("./actions");

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const good = { postcode: "ca25 5ab", contact: "email", email: " Jo@Example.com", phone: "", notify: "on", source: "instant_price" };

describe("normalising, the same as the database", () => {
  it("tidies postcodes, mobiles and emails", () => {
    expect(normalisePostcode("ca143xx")).toBe("CA14 3XX");
    expect(normalisePostcode(" la9  4aa ")).toBe("LA9 4AA");
    expect(normalisePostcode("Workington")).toBeNull();
    expect(normaliseUkMobile("07700 900321")).toBe("+447700900321");
    expect(normaliseUkMobile("+44 (7700) 900-321")).toBe("+447700900321");
    expect(normaliseUkMobile("01946 123456")).toBeNull(); // a landline can't get a text
    expect(normaliseEmail(" Jo@Example.COM ")).toBe("jo@example.com");
    expect(normaliseEmail("jo@@example.com")).toBeNull();
  });
});

describe("parseInterestForm", () => {
  it("keeps only the contact they chose, and always sends the current consent version", () => {
    const r = parseInterestForm(form({ ...good, phone: "07700900321" }));
    expect(r).toMatchObject({
      ok: true,
      args: { p_postcode: "CA25 5AB", p_email: "jo@example.com", p_phone: null, p_notify: true, p_source: "instant_price",
              p_consent_version: INTEREST_CONSENT_VERSION },
    });
    const byPhone = parseInterestForm(form({ ...good, contact: "phone", phone: "07700 900321" }));
    expect(byPhone).toMatchObject({ ok: true, args: { p_email: null, p_phone: "+447700900321" } });
  });

  it("requires the tick: unticked, nothing goes to the database", () => {
    const r = parseInterestForm(form({ ...good, notify: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.notify).toMatch(/Tell me when booking opens near me/);
  });

  it("gives plain messages per field, and keeps what they typed", () => {
    const r = parseInterestForm(form({ ...good, postcode: "CA25", email: "jo at example" }));
    expect(r).toMatchObject({ ok: false, values: { postcode: "CA25", email: "jo at example", contact: "email" } });
    if (!r.ok) expect(Object.keys(r.fieldErrors).sort()).toEqual(["email", "postcode"]);
    const p = parseInterestForm(form({ ...good, contact: "phone", phone: "01946 123456" }));
    if (!p.ok) expect(p.fieldErrors.phone).toMatch(/UK mobile/);
  });

  it("never takes a source or consent version the page didn't mean to send", () => {
    expect(parseInterestForm(form({ ...good, source: "facebook" }))).toMatchObject({ ok: false, badSource: true });
    const r = parseInterestForm(form({ ...good, consent_version: "v-made-up" }));
    expect(r).toMatchObject({ ok: true, args: { p_consent_version: INTEREST_CONSENT_VERSION } });
  });
});

describe("Turnstile, optional", () => {
  const on = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" };
  const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response);

  it("is off unless both keys are set, and then checks nothing", async () => {
    expect(turnstileEnabled({})).toBe(false);
    expect(turnstileEnabled({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site" })).toBe(false);
    expect(turnstileSiteKey({ TURNSTILE_SECRET_KEY: "secret" })).toBeNull();
    expect(turnstileSiteKey(on)).toBe("site");
    const f = reply({ success: true });
    expect(await verifyTurnstile(null, { env: {}, fetchImpl: f })).toBe("off");
    expect(f).not.toHaveBeenCalled();
  });

  it("passes only a token Cloudflare accepts, sending the secret and token but no IP address", async () => {
    const f = reply({ success: true });
    expect(await verifyTurnstile("tok", { env: on, fetchImpl: f })).toBe("passed");
    const body = (f.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect([...body.keys()].sort()).toEqual(["response", "secret"]);
    expect(await verifyTurnstile("tok", { env: on, fetchImpl: reply({ success: false }) })).toBe("failed");
    expect(await verifyTurnstile("", { env: on, fetchImpl: reply({ success: true }) })).toBe("failed");
  });

  it("says unavailable (not passed) when Cloudflare can't be reached", async () => {
    expect(await verifyTurnstile("tok", { env: on, fetchImpl: reply({}, false) })).toBe("unavailable");
    const boom = vi.fn(async () => { throw new Error("network"); });
    expect(await verifyTurnstile("tok", { env: on, fetchImpl: boom as unknown as typeof fetch })).toBe("unavailable");
  });
});

describe("registerInterest (the Server Action)", () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-tests-0000000000");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  });

  it("calls register_interest with the checked values and says thanks", async () => {
    rpc.mockResolvedValue({ data: "thanks", error: null });
    expect(await registerInterest(initialInterestState, form(good))).toEqual({ status: "thanks" });
    expect(rpc).toHaveBeenCalledWith("register_interest", {
      p_postcode: "CA25 5AB", p_email: "jo@example.com", p_phone: null, p_notify: true,
      p_source: "instant_price", p_consent_version: INTEREST_CONSENT_VERSION,
    });
  });

  it("says thanks to a bot that fills the honeypot, and stores nothing", async () => {
    expect(await registerInterest(initialInterestState, form({ ...good, company: "Acme" }))).toEqual({ status: "thanks" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stores nothing without the tick", async () => {
    const r = await registerInterest(initialInterestState, form({ ...good, notify: "" }));
    expect(r).toMatchObject({ status: "error", fieldErrors: { notify: expect.any(String) } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("checks Turnstile when it's switched on, before touching the database", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    const r = await registerInterest(initialInterestState, form(good)); // no token
    expect(r).toMatchObject({ status: "error", fieldErrors: { captcha: expect.any(String) } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("turns the database's codes into plain words next to the right field", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PC031", message: "Mobile not valid" } });
    const r = await registerInterest(initialInterestState, form({ ...good, contact: "phone", phone: "07700 900321" }));
    expect(r).toMatchObject({ status: "error", fieldErrors: { phone: "Enter an email address or a UK mobile number." } });
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "secret internals" } });
    const other = await registerInterest(initialInterestState, form(good));
    expect(other).toMatchObject({ status: "error", message: "Something went wrong. Please try again." });
    expect(JSON.stringify(other)).not.toContain("internals");
  });
});
