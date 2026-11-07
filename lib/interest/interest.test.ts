import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
const createAdminClient = vi.fn(() => ({ rpc }));
vi.mock("@/lib/db/admin", () => ({ createAdminClient }));
vi.mock("@/lib/db/server", () => ({ createClient: async () => { throw new Error("the action must not use the visitor's client"); } }));

const { normaliseEmail, normalisePostcode, normaliseUkMobile, parseInterestForm, interestConsentText, INTEREST_CONSENT_VERSION,
  initialInterestState } = await import("./form");
const { resetTurnstileWarning, turnstileEnabled, turnstileHostnames, turnstileSiteKey, verifyTurnstile } = await import("./turnstile");
const { registerInterestOnHoldingPage, registerInterestOnInstantPrice } = await import("./actions");
const { csvCell, interestCsv } = await import("./csv");

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const good = { postcode: "ca25 5ab", contact: "email", email: " Jo@Example.com", phone: "", notify: "on" };

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

  it("refuses postcode areas that don't exist (review 11)", () => {
    expect(normalisePostcode("ZZ9 9ZZ")).toBeNull();
    expect(normalisePostcode("BX1 1LT")).toBeNull(); // non-geographic
    for (const ok of ["B1 1AA", "EC1A 1BB", "W1A 0AX", "BT1 5GS", "CA28 6AA"]) expect(normalisePostcode(ok)).not.toBeNull();
  });

  it("takes plain ASCII email addresses only (review 6)", () => {
    expect(normaliseEmail("jo​@example.com")).toBeNull(); // zero-width space
    expect(normaliseEmail("jo‮@example.com")).toBeNull(); // right-to-left override
    expect(normaliseEmail("jö@example.com")).toBeNull();
    expect(normaliseEmail("jo smith@example.com")).toBeNull();
  });
});

describe("parseInterestForm", () => {
  it("keeps only the contact they chose, and takes the source and consent version from the server", () => {
    const r = parseInterestForm(form({ ...good, phone: "07700900321", source: "facebook", consent_version: "v-attacker-chosen" }), "instant_price");
    expect(r).toMatchObject({
      ok: true,
      args: { p_postcode: "CA25 5AB", p_email: "jo@example.com", p_phone: null, p_notify: true, p_source: "instant_price",
              p_consent_version: INTEREST_CONSENT_VERSION },
    });
    const byPhone = parseInterestForm(form({ ...good, contact: "phone", phone: "07700 900321" }), "holding_page");
    expect(byPhone).toMatchObject({ ok: true, args: { p_email: null, p_phone: "+447700900321", p_source: "holding_page" } });
  });

  it("requires the tick: unticked, nothing goes to the database", () => {
    const r = parseInterestForm(form({ ...good, notify: "" }), "instant_price");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.notify).toMatch(/Tell me when booking opens near me/);
  });

  it("gives plain messages per field, and keeps what they typed", () => {
    const r = parseInterestForm(form({ ...good, postcode: "CA25", email: "jo at example" }), "instant_price");
    expect(r).toMatchObject({ ok: false, values: { postcode: "CA25", email: "jo at example", contact: "email" } });
    if (!r.ok) expect(Object.keys(r.fieldErrors).sort()).toEqual(["email", "postcode"]);
    const p = parseInterestForm(form({ ...good, contact: "phone", phone: "01946 123456" }), "instant_price");
    if (!p.ok) expect(p.fieldErrors.phone).toMatch(/UK mobile/);
  });
});

describe("consent wording (review 4)", () => {
  it("says both uses, and the retention from settings", () => {
    const t = interestConsentText(6);
    expect(t).toContain("one message when booking opens near you");
    expect(t).toContain("help us decide where to open next");
    expect(t).toContain("after 6 months");
    expect(t).not.toMatch(/\bonly\b/);
  });
});

describe("CSV export (review 6)", () => {
  it("defuses anything a spreadsheet would run as a formula", () => {
    for (const bad of ['=HYPERLINK("http://x","y")@example.com', "+447700900321", "-1+1", "@SUM(A1)", "\tx", "\rx"]) {
      expect(csvCell(bad).startsWith(`"'`)).toBe(true);
    }
    expect(csvCell("jo@example.com")).toBe('"jo@example.com"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell(null)).toBe('""');
  });

  it("writes a header and one quoted line per row", () => {
    const csv = interestCsv([{ postcode: "CA25 5AB", postcode_district: "CA25", email: "=cmd|' /C calc'!A0@x.com", phone: null,
      registered_at: "2026-11-07T10:00:00Z", notified_at: null }]);
    expect(csv).toBe(`postcode,postcode_district,email,phone,registered_at,notified_at\r\n` +
      `"CA25 5AB","CA25","'=cmd|' /C calc'!A0@x.com","","2026-11-07T10:00:00Z",""\r\n`);
  });

  it("writes mobiles as 447… (no plus, no apostrophe), ready for bulk-SMS import (final check note 2)", () => {
    const csv = interestCsv([{ postcode: "CA26 1AA", postcode_district: "CA26", email: null, phone: "+447700900321",
      registered_at: "2026-11-07T10:00:00Z", notified_at: null }]);
    expect(csv.split("\r\n")[1]).toBe(`"CA26 1AA","CA26","","447700900321","2026-11-07T10:00:00Z",""`);
  });
});

describe("Turnstile in production (final check B and note 3)", () => {
  const prod = { NODE_ENV: "production", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "s", TURNSTILE_SECRET_KEY: "k" };
  const ok = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, hostname: "pingclean.co.uk" }) }) as Response);

  it("fails closed, with a warning and no personal data, when the allowed hostname is unknown", async () => {
    resetTurnstileWarning();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await verifyTurnstile("tok", { env: prod, fetchImpl: ok })).toBe("failed");
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/NEXT_PUBLIC_SITE_URL isn't set/));
    expect(await verifyTurnstile("tok", { env: { ...prod, NEXT_PUBLIC_SITE_URL: "https://pingclean.co.uk" }, fetchImpl: ok })).toBe("passed");
    warn.mockRestore();
  });

  it("refuses a post without a token whenever Turnstile is on (a bot posting the action to another route)", async () => {
    const f = vi.fn();
    expect(await verifyTurnstile(undefined, { env: { ...prod, NEXT_PUBLIC_SITE_URL: "https://pingclean.co.uk" }, fetchImpl: f as unknown as typeof fetch })).toBe("failed");
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses submissions in production when no keys are set, warning once (last check)", async () => {
    resetTurnstileWarning();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await verifyTurnstile("tok", { env: { NODE_ENV: "production" } })).toBe("unavailable");
    expect(await verifyTurnstile(null, { env: { NODE_ENV: "production" } })).toBe("unavailable");
    expect(warn.mock.calls.filter((c) => /Turnstile keys are not set in production/.test(String(c[0])))).toHaveLength(1);
    // Previews and local development carry on without it.
    expect(await verifyTurnstile("tok", { env: { NODE_ENV: "production", VERCEL_ENV: "preview" } })).toBe("off");
    expect(await verifyTurnstile("tok", { env: { NODE_ENV: "development" } })).toBe("off");
    warn.mockRestore();
  });
});

describe("Turnstile, optional", () => {
  const on = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret", NEXT_PUBLIC_SITE_URL: "https://pingclean.co.uk" };
  const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response);

  it("is off unless both keys are set, and then checks nothing", async () => {
    expect(turnstileEnabled({})).toBe(false);
    expect(turnstileSiteKey({ TURNSTILE_SECRET_KEY: "secret" }, )).toBeNull();
    expect(turnstileSiteKey(on)).toBe("site");
    const f = reply({ success: true });
    expect(await verifyTurnstile(null, { env: {}, fetchImpl: f })).toBe("off");
    expect(f).not.toHaveBeenCalled();
  });

  it("warns once, without any personal data, when only one key is set (review 10)", () => {
    resetTurnstileWarning();
    const warn = vi.fn();
    expect(turnstileEnabled({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site" }, warn)).toBe(false);
    expect(turnstileEnabled({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site" }, warn)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/only NEXT_PUBLIC_TURNSTILE_SITE_KEY is set/);
    resetTurnstileWarning();
    const quiet = vi.fn();
    turnstileEnabled({}, quiet);
    turnstileEnabled(on, quiet);
    expect(quiet).not.toHaveBeenCalled();
  });

  it("passes only a token Cloudflare accepts for Ping's own hostname, sending no IP address (review 10)", async () => {
    const f = reply({ success: true, hostname: "pingclean.co.uk" });
    expect(await verifyTurnstile("tok", { env: on, fetchImpl: f })).toBe("passed");
    const body = (f.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect([...body.keys()].sort()).toEqual(["response", "secret"]);
    expect(await verifyTurnstile("tok", { env: on, fetchImpl: reply({ success: true, hostname: "evil.example" }) })).toBe("failed");
    expect(await verifyTurnstile("tok", { env: on, fetchImpl: reply({ success: true }) })).toBe("failed");
    expect(await verifyTurnstile("tok", { env: on, fetchImpl: reply({ success: false, hostname: "pingclean.co.uk" }) })).toBe("failed");
    expect(await verifyTurnstile("", { env: on, fetchImpl: reply({ success: true }) })).toBe("failed");
  });

  it("accepts the preview's own address on a Vercel preview, and skips the hostname check locally", async () => {
    const preview = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "s", TURNSTILE_SECRET_KEY: "k", VERCEL_ENV: "preview",
      VERCEL_URL: "ping-abc.vercel.app", VERCEL_BRANCH_URL: "ping-git-x.vercel.app" };
    expect([...turnstileHostnames(preview)].sort()).toEqual(["ping-abc.vercel.app", "ping-git-x.vercel.app"]);
    expect(await verifyTurnstile("tok", { env: preview, fetchImpl: reply({ success: true, hostname: "ping-git-x.vercel.app" }) })).toBe("passed");
    expect(turnstileHostnames({ VERCEL_ENV: "production", VERCEL_URL: "ping.vercel.app" }).size).toBe(0);
    const local = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "s", TURNSTILE_SECRET_KEY: "k" };
    expect(await verifyTurnstile("tok", { env: local, fetchImpl: reply({ success: true, hostname: "localhost" }) })).toBe("passed");
  });

  it("says unavailable (not passed) when Cloudflare can't be reached", async () => {
    expect(await verifyTurnstile("tok", { env: on, fetchImpl: reply({}, false) })).toBe("unavailable");
    const boom = vi.fn(async () => { throw new Error("network"); });
    expect(await verifyTurnstile("tok", { env: on, fetchImpl: boom as unknown as typeof fetch })).toBe("unavailable");
  });
});

describe("the Server Actions", () => {
  beforeEach(() => {
    rpc.mockReset();
    createAdminClient.mockClear();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-tests-0000000000");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  });

  it("call register_interest through the server-only client, with the source fixed by which action it is", async () => {
    rpc.mockResolvedValue({ data: "thanks", error: null });
    expect(await registerInterestOnInstantPrice(initialInterestState, form({ ...good, source: "holding_page" }))).toEqual({ status: "thanks" });
    expect(await registerInterestOnHoldingPage(initialInterestState, form(good))).toEqual({ status: "thanks" });
    expect(createAdminClient).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls).toEqual([
      ["register_interest", { p_postcode: "CA25 5AB", p_email: "jo@example.com", p_phone: null, p_notify: true,
        p_source: "instant_price", p_consent_version: INTEREST_CONSENT_VERSION }],
      ["register_interest", expect.objectContaining({ p_source: "holding_page" })],
    ]);
  });

  it("say thanks to a bot that fills the honeypot, and store nothing", async () => {
    expect(await registerInterestOnHoldingPage(initialInterestState, form({ ...good, company: "Acme" }))).toEqual({ status: "thanks" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("store nothing without the tick", async () => {
    const r = await registerInterestOnHoldingPage(initialInterestState, form({ ...good, notify: "" }));
    expect(r).toMatchObject({ status: "error", fieldErrors: { notify: expect.any(String) } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("check Turnstile when it's switched on, before touching the database", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    const r = await registerInterestOnHoldingPage(initialInterestState, form(good)); // no token
    expect(r).toMatchObject({ status: "error", fieldErrors: { captcha: expect.any(String) } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("turn the database's codes into plain words next to the right field, and never show raw errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PC031", message: "Mobile not valid" } });
    const r = await registerInterestOnHoldingPage(initialInterestState, form({ ...good, contact: "phone", phone: "07700 900321" }));
    expect(r).toMatchObject({ status: "error", fieldErrors: { phone: "Enter an email address or a UK mobile number." } });
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "secret internals" } });
    const other = await registerInterestOnHoldingPage(initialInterestState, form(good));
    expect(other).toMatchObject({ status: "error", message: "Something went wrong. Please try again." });
    expect(JSON.stringify(other)).not.toContain("internals");
  });

  it("ask them to try again if the server key is missing", async () => {
    createAdminClient.mockImplementationOnce(() => { throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set"); });
    const r = await registerInterestOnHoldingPage(initialInterestState, form(good));
    expect(r).toMatchObject({ status: "error", message: "Something went wrong. Please try again." });
  });
});
