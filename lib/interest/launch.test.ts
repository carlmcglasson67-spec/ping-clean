import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
const createAdminClient = vi.fn(() => ({ rpc }));
vi.mock("@/lib/db/admin", () => ({ createAdminClient }));
vi.mock("@/lib/db/server", () => ({ createClient: async () => { throw new Error("the action must not use the visitor's client"); } }));

const { LAUNCH_CONSENT_VERSION, LAUNCH_KINDS, LAUNCH_NOTE_MAX, LAUNCH_QUESTIONS, initialLaunchState, launchAnswerLabel, launchConsentText,
  launchQuestionLabel, parseLaunchForm } = await import("./launch");
const { registerLaunchInterest } = await import("./actions");
const { answersCell, interestCsv } = await import("./csv");

const form = (fields: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
  return fd;
};
const customer = { kind: "customer", first_name: " Jo ", postcode: "ca25 5ab", contact: "email", email: " Jo@Example.com", phone: "", notify: "on" };
const cleaner = { kind: "cleaner", first_name: "", postcode: "CA14 3XX", contact: "phone", email: "", phone: "07700 900321", notify: "on" };

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: "thanks", error: null });
  createAdminClient.mockClear();
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
});

describe("the questions", () => {
  it("use keys and option values the database's shape check accepts, with no repeats", () => {
    for (const kind of LAUNCH_KINDS) {
      const keys = LAUNCH_QUESTIONS[kind].map((q) => q.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys).not.toContain("note");
      for (const q of LAUNCH_QUESTIONS[kind]) {
        expect(q.key).toMatch(/^[a-z_]{1,32}$/);
        expect(q.options.length).toBeGreaterThan(1);
        expect(q.options.length).toBeLessThanOrEqual(8);
        expect(new Set(q.options.map((o) => o.value)).size).toBe(q.options.length);
        for (const o of q.options) expect(o.value).toMatch(/^[a-z0-9_]{1,40}$/);
        if (q.pick === "many") expect(q.max ?? q.options.length).toBeLessThanOrEqual(8);
      }
    }
  });

  it("never mention a price, a deep clean, end of tenancy or changeovers (regular cleans only, no price)", () => {
    const words = JSON.stringify(LAUNCH_QUESTIONS).toLowerCase();
    for (const banned of ["£", "price", "deep clean", "tenancy", "changeover", "airbnb", "holiday"]) expect(words).not.toContain(banned);
  });

  it("turn stored keys back into the words people saw", () => {
    expect(launchQuestionLabel("customer", "frequency")).toBe("How often would you want a clean?");
    expect(launchAnswerLabel("customer", "frequency", "weekly")).toBe("Every week");
    expect(launchAnswerLabel("cleaner", "hours", "8_to_16")).toBe("8 to 16");
    expect(launchAnswerLabel("customer", "retired_question", "old_value")).toBe("old_value");
  });

  it("word the consent for each kind, quoting the retention period it is given", () => {
    expect(launchConsentText("customer", 6)).toContain("when booking opens near you");
    expect(launchConsentText("cleaner", 6)).toContain("taking on cleaners near you");
    expect(launchConsentText("cleaner", 9)).toContain("after 9 months");
  });
});

describe("parseLaunchForm", () => {
  it("takes a customer with answers: one value for pick-one, a list for pick-many", () => {
    const p = parseLaunchForm(form({ ...customer, a_frequency: "weekly", a_bedrooms: "3", a_priorities: ["reliable", "proof"], note: "  Never turned up.\r\nTwice.  " }));
    expect(p).toMatchObject({
      ok: true,
      args: {
        p_kind: "customer", p_first_name: "Jo", p_postcode: "CA25 5AB", p_email: "jo@example.com", p_phone: null, p_notify: true,
        p_consent_version: LAUNCH_CONSENT_VERSION,
        p_answers: { frequency: "weekly", bedrooms: "3", priorities: ["reliable", "proof"], note: "Never turned up.\nTwice." },
      },
    });
  });

  it("takes a cleaner by mobile with no name and no answers: every question is optional", () => {
    const p = parseLaunchForm(form(cleaner));
    expect(p).toMatchObject({ ok: true, args: { p_kind: "cleaner", p_first_name: null, p_email: null, p_phone: "+447700900321", p_answers: {} } });
  });

  it("keeps only the chosen contact", () => {
    const p = parseLaunchForm(form({ ...customer, phone: "07700 900321" }));
    expect(p).toMatchObject({ ok: true, args: { p_email: "jo@example.com", p_phone: null } });
  });

  it("drops anything the browser invents: unknown options, the other kind's questions, extra picks", () => {
    const p = parseLaunchForm(form({
      ...customer,
      a_frequency: ["monthly_or_whenever", "weekly", "fortnightly"], // one real pick is kept
      a_experience: "over_3", // a cleaner question
      a_priorities: ["reliable", "proof", "checked", "no_contract", "reliable", "<script>"], // max 3, no repeats
      a_made_up: "x",
    }));
    expect(p.ok && p.args.p_answers).toEqual({ frequency: "weekly", priorities: ["reliable", "proof", "checked"] });
  });

  it("treats an unknown kind as a customer rather than storing it", () => {
    const p = parseLaunchForm(form({ ...customer, kind: "landlord" }));
    expect(p).toMatchObject({ ok: true, args: { p_kind: "customer" } });
  });

  it("explains each thing the person can fix, next to its field, and gives back what they typed", () => {
    const p = parseLaunchForm(form({ kind: "cleaner", first_name: "R2-D2 <b>", postcode: "Workington", contact: "phone", phone: "01946 123456", notify: "",
      a_hours: "under_8", note: "x".repeat(LAUNCH_NOTE_MAX + 1) }));
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(Object.keys(p.fieldErrors).sort()).toEqual(["firstName", "note", "notify", "phone", "postcode"]);
    expect(p.fieldErrors.notify).toContain("taking on cleaners");
    expect(p.values).toMatchObject({ kind: "cleaner", postcode: "Workington", phone: "01946 123456", notify: false, answers: { hours: ["under_8"] } });
  });

  it("accepts real first names and refuses control characters in the note", () => {
    for (const ok of ["Jo", "Mary-Anne", "O’Neil", "D'Arcy", "Zoë", "Anne Marie"]) {
      expect({ ok, r: parseLaunchForm(form({ ...customer, first_name: ok })).ok }).toEqual({ ok, r: true });
    }
    for (const bad of ["Jo1", "=cmd", "@jo", "-Jo", "x".repeat(61)]) {
      expect({ bad, r: parseLaunchForm(form({ ...customer, first_name: bad })).ok }).toEqual({ bad, r: false });
    }
    expect(parseLaunchForm(form({ ...customer, note: "hello\u0007" })).ok).toBe(false);
    expect(parseLaunchForm(form({ ...customer, note: "line one\nline two\ttabbed" })).ok).toBe(true);
  });
});

describe("registerLaunchInterest", () => {
  it("calls register_launch_interest with the service role and says thanks, naming the kind", async () => {
    const r = await registerLaunchInterest(initialLaunchState, form({ ...cleaner, a_drives: "yes" }));
    expect(r).toEqual({ status: "thanks", kind: "cleaner" });
    expect(createAdminClient).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("register_launch_interest", expect.objectContaining({ p_kind: "cleaner", p_answers: { drives: "yes" }, p_consent_version: LAUNCH_CONSENT_VERSION }));
  });

  it("gives a bot that fills the hidden field the normal reply and stores nothing", async () => {
    const r = await registerLaunchInterest(initialLaunchState, form({ ...customer, company: "Acme" }));
    expect(r).toEqual({ status: "thanks", kind: "customer" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("doesn't touch the database when the form is wrong or the box isn't ticked", async () => {
    const r = await registerLaunchInterest(initialLaunchState, form({ ...customer, notify: "" }));
    expect(r).toMatchObject({ status: "error", fieldErrors: { notify: expect.any(String) } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("checks Turnstile when it's switched on, before touching the database", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    const r = await registerLaunchInterest(initialLaunchState, form(customer));
    expect(r).toMatchObject({ status: "error", fieldErrors: { captcha: expect.any(String) } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("turns the database's codes into plain words by the right field, and never shows raw errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PC030", message: "Postcode not valid" } });
    expect(await registerLaunchInterest(initialLaunchState, form(customer))).toMatchObject({ status: "error", fieldErrors: { postcode: expect.any(String) } });
    rpc.mockResolvedValue({ data: null, error: { code: "PC031", message: "Mobile not valid" } });
    expect(await registerLaunchInterest(initialLaunchState, form(cleaner))).toMatchObject({ status: "error", fieldErrors: { phone: expect.any(String) } });
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "secret internals" } });
    const other = await registerLaunchInterest(initialLaunchState, form(customer));
    expect(other).toMatchObject({ status: "error", message: "Something went wrong. Please try again." });
    expect(JSON.stringify(other)).not.toContain("internals");
  });

  it("asks them to try again if the server key is missing", async () => {
    createAdminClient.mockImplementationOnce(() => { throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set"); });
    expect(await registerLaunchInterest(initialLaunchState, form(customer))).toMatchObject({ status: "error", message: "Something went wrong. Please try again." });
  });
});

describe("the export's answers cell", () => {
  it("is one readable line: keys in order, the note last, new lines flattened", () => {
    expect(answersCell({ note: "Never\nturned up", priorities: ["reliable", "proof"], frequency: "weekly" }))
      .toBe("frequency: weekly; priorities: reliable, proof; note: Never turned up");
    expect(answersCell({})).toBe("");
    expect(answersCell(null)).toBe("");
  });

  it("can't start a spreadsheet formula, whatever the note says", () => {
    const csv = interestCsv([{ kind: "customer", first_name: "Jo", postcode: "CA25 5AB", postcode_district: "CA25", email: "jo@example.com", phone: null,
      answers: { note: '=HYPERLINK("http://x","y")' }, registered_at: "2026-11-14T10:00:00Z", notified_at: null }]);
    expect(csv.split("\r\n")[1]!.endsWith(`"note: =HYPERLINK(""http://x"",""y"")"`)).toBe(true);
  });
});
