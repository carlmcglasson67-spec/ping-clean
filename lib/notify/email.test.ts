// Customer emails about payments (payments PR 8): when they're on, what they say, how they're sent.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
const paymentKind = { select: () => paymentKind, eq: () => paymentKind, maybeSingle: async () => ({ data: { kind: "visit" }, error: null }) };
vi.mock("@/lib/db/admin", () => ({ createAdminClient: () => ({ rpc, from: () => paymentKind }) }));

const { emailConfig, noticeEmail, sendDueNotices } = await import("./email");

const KEY = "re_" + "testKeyNotReal0000000000";
const FROM = "Ping Clean <hello@pingclean.co.uk>";
const notice = (over: Record<string, unknown> = {}) => ({ notice_id: "00000000-0000-4000-9100-000000000001", kind: "payment_failed", email: "anna@example.com",
  full_name: "Anna Test", payment_id: "00000000-0000-4000-f000-0000000000aa", amount_pence: 5000, clean_date: "2026-11-12", ...over });

function db(rows: ReturnType<typeof notice>[]) {
  const sent: Record<string, unknown>[] = [];
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "notices_claim") return { data: rows, error: null };
    if (fn === "notice_sent") { sent.push(args); return { data: null, error: null }; }
    return { data: null, error: { code: "XX000" } };
  });
  return sent;
}

beforeEach(() => {
  rpc.mockReset();
  vi.unstubAllEnvs();
  vi.stubEnv("RESEND_API_KEY", KEY);
  vi.stubEnv("PING_EMAIL_FROM", FROM);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pingclean.co.uk");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("whether email is on", () => {
  it("needs a Resend key and a from address", () => {
    expect(emailConfig({})).toBeNull();
    expect(emailConfig({ RESEND_API_KEY: KEY })).toBeNull();
    expect(emailConfig({ RESEND_API_KEY: "not-a-key", PING_EMAIL_FROM: FROM })).toBeNull();
    expect(emailConfig({ RESEND_API_KEY: KEY, PING_EMAIL_FROM: "no address here" })).toBeNull();
    expect(emailConfig({ RESEND_API_KEY: KEY, PING_EMAIL_FROM: "Ping <a@b.co>\r\nBcc: x@y.z" })).toBeNull();
    expect(emailConfig({ RESEND_API_KEY: KEY, PING_EMAIL_FROM: FROM })).toEqual({ key: KEY, from: FROM });
    expect(emailConfig({ RESEND_API_KEY: KEY, PING_EMAIL_FROM: "hello@pingclean.co.uk" })).not.toBeNull();
  });

  it("claims nothing while it's off, so notices wait", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetcher = vi.fn();
    expect(await sendDueNotices(20, fetcher)).toEqual({ off: true, claimed: 0, sent: 0, failed: 0 });
    expect(rpc).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("what the emails say", () => {
  const facts = { firstName: "Anna", amountPence: 5000, cleanDate: "2026-11-12", link: "https://pingclean.co.uk/account/pay/abc" };
  it("names the clean, the amount and one thing to do, for each kind", () => {
    for (const kind of ["payment_failed", "payment_needs_confirming", "block_on_hold"] as const) {
      const m = noticeEmail(kind, facts);
      expect(m.text).toContain("Hello Anna,");
      expect(m.text).toContain("£50.00");
      expect(m.text).toContain(facts.link);
      expect(m.html).toContain(`href="${facts.link}"`);
      expect(m.subject.length).toBeGreaterThan(10);
    }
    expect(noticeEmail("block_on_hold", facts).text).toMatch(/on hold/);
    const fee = noticeEmail("payment_failed", { ...facts, lateCancelFee: true });
    expect(fee.subject).toBe("We couldn't take your late-cancellation fee");
    expect(fee.text).toMatch(/the late-cancellation fee for your clean/);
    expect(noticeEmail("block_on_hold", { ...facts, lateCancelFee: true }).text).toMatch(/late-cancellation fee/);
    expect(noticeEmail("block_ended_unpaid", { ...facts, amountPence: null, cleanDate: null }).text).toMatch(/cancelled/);
  });

  it("copes without a name, and never lets a name become markup", () => {
    expect(noticeEmail("payment_failed", { ...facts, firstName: null }).text).toMatch(/^Hello,/);
    const m = noticeEmail("payment_failed", { ...facts, firstName: `<img src=x onerror="1">` });
    expect(m.html).not.toContain("<img");
    expect(m.html).toContain("&lt;img");
  });

  it("promises nothing with a number in it that settings could change", () => {
    for (const kind of ["payment_failed", "payment_needs_confirming", "block_on_hold", "block_ended_unpaid"] as const) {
      expect(noticeEmail(kind, { firstName: null, amountPence: null, cleanDate: null, link: "https://x.test" }).text).not.toMatch(/\d+ (days|hours)/);
    }
  });
});

describe("sending", () => {
  it("sends each notice once through Resend, with the notice as the idempotency key, and marks it sent", async () => {
    const sent = db([notice(), notice({ notice_id: "00000000-0000-4000-9100-000000000002", kind: "block_ended_unpaid", payment_id: null, amount_pence: null, clean_date: null })]);
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await sendDueNotices(20, fetcher as unknown as typeof fetch)).toEqual({ claimed: 2, sent: 2, failed: 0 });

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ authorization: `Bearer ${KEY}`, "idempotency-key": "ping-notice-00000000-0000-4000-9100-000000000001" });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ from: FROM, to: ["anna@example.com"] });
    expect(body.text).toContain("https://pingclean.co.uk/account/pay/00000000-0000-4000-f000-0000000000aa");
    expect(JSON.parse((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).text).toContain("https://pingclean.co.uk/account\n");
    expect(sent).toEqual([
      { p_notice: "00000000-0000-4000-9100-000000000001", p_error: null },
      { p_notice: "00000000-0000-4000-9100-000000000002", p_error: null },
    ]);
  });

  it("leaves a notice for the next run when Resend says no or can't be reached, and carries on with the rest", async () => {
    const sent = db([notice(), notice({ notice_id: "00000000-0000-4000-9100-000000000002" }), notice({ notice_id: "00000000-0000-4000-9100-000000000003", email: null }),
      notice({ notice_id: "00000000-0000-4000-9100-000000000004" })]);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 422 }))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    expect(await sendDueNotices(20, fetcher as unknown as typeof fetch)).toEqual({ claimed: 4, sent: 1, failed: 3 });
    expect(sent.map((s) => s.p_error)).toEqual(["resend_422", "resend_unreachable", "no_email_address", null]);
  });
});
