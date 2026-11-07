import { describe, expect, it } from "vitest";
import { resolveSiteUrl } from "@/lib/env";
import { safeNext, signedOutEntry } from "./next";
import { passwordBytes, passwordChecks, passwordProblem } from "./password";
import { parseConfirmForm } from "./confirm-fields";
import { maskEmail } from "./mask";
import { canChooseNewPassword, freshEmailLink, makeResetPass, resetPassSecret } from "./recovery";
import { postLoginPath } from "./roles";

describe("safeNext: only paths inside the apps", () => {
  it("keeps app paths, with their query, and drops the fragment", () => {
    expect(safeNext("/account")).toBe("/account");
    expect(safeNext("/account/book?home=8f2e&block=4")).toBe("/account/book?home=8f2e&block=4");
    expect(safeNext("/work/apply")).toBe("/work/apply");
    expect(safeNext("/admin/settings#prices")).toBe("/admin/settings");
  });

  it.each([
    ["absolute URL", "https://evil.example/account"],
    ["protocol-relative", "//evil.example/account"],
    ["backslash trick", "/\\evil.example"],
    ["backslash in the middle", "/account\\..\\..\\evil"],
    ["scheme", "javascript:alert(1)"],
    ["data URL", "data:text/html,hi"],
    ["no leading slash", "account"],
    ["newline (header injection)", "/account\r\nSet-Cookie: x=1"],
    ["tab", "/acc\tount"],
    ["public page", "/"],
    ["public page", "/clean-for-ping"],
    ["look-alike prefix", "/accounting"],
    ["look-alike prefix", "/workington"],
    ["look-alike prefix", "/administrator"],
    ["dot segments out of the apps", "/account/../clean-for-ping"],
    ["encoded double slash", "/%2F%2Fevil.example"],
    ["too long", "/account/" + "a".repeat(600)],
    ["empty", ""],
  ])("drops %s: %s", (_why, raw) => {
    expect(safeNext(raw)).toBeNull();
  });

  it("drops anything that isn't a string", () => {
    expect(safeNext(null)).toBeNull();
    expect(safeNext(undefined)).toBeNull();
  });

  it("resolves dot segments before checking, so they can't climb into another app unseen", () => {
    expect(safeNext("/account/../admin")).toBe("/admin"); // then postLoginPath keeps a customer out
    expect(postLoginPath("customer", "/account/../admin")).toBe("/account");
  });
});

describe("postLoginPath with the allowlist", () => {
  it("lets a new customer go to checkout or to the cleaner application (B1), and nowhere else", () => {
    expect(postLoginPath("customer", "/account/book?home=1")).toBe("/account/book?home=1");
    expect(postLoginPath("customer", "/work/apply")).toBe("/work/apply");
    expect(postLoginPath("customer", "/work/apply?from=site")).toBe("/work/apply?from=site");
    expect(postLoginPath("customer", "/work")).toBe("/account");
    expect(postLoginPath("customer", "/work/jobs")).toBe("/account");
    expect(postLoginPath("customer", "/work/apply/../jobs")).toBe("/account");
    expect(postLoginPath("customer", "/admin")).toBe("/account");
  });

  it("never sends a cleaner or admin across areas", () => {
    expect(postLoginPath("cleaner", "/work/apply")).toBe("/work/apply"); // their own area
    expect(postLoginPath("cleaner", "/account/book")).toBe("/work");
    expect(postLoginPath("admin", "/work/apply")).toBe("/admin");
  });
});

describe("password rules", () => {
  it("accepts a sensible password", () => {
    expect(passwordProblem("blue kettle 42", "anna@example.com")).toBeNull();
    expect(passwordChecks("blue kettle 42").every((c) => c.ok)).toBe(true);
  });

  it.each([
    ["short", "abc123", "at least 10"],
    ["no number", "bluekettleabc", "at least one number"],
    ["no letters", "12345678901", "letters"],
    ["common", "password123", "too easy"],
    ["one character repeated", "aaaaaaaaaa1", null],
    ["contains the email name", "annasmith2026", "too easy"],
    ["over 72 bytes", "a1".repeat(40), "too long"],
    ["over 72 bytes in accented letters (41 characters, 81 bytes)", "é".repeat(40) + "1", "too long"],
    ["over 72 bytes in emoji (19 characters)", "🧽".repeat(18) + "a1", "too long"],
  ])("refuses %s", (_why, pw, words) => {
    const problem = passwordProblem(pw, "annasmith@example.com");
    expect(problem).not.toBeNull();
    if (words) expect(problem!.toLowerCase()).toContain(words.toLowerCase());
  });

  it("counts bytes, as bcrypt does, not characters", () => {
    expect(passwordBytes("abc")).toBe(3);
    expect(passwordBytes("é")).toBe(2);
    expect(passwordBytes("🧽")).toBe(4);
    expect(passwordProblem("é".repeat(30) + "kettle 4")).toBeNull(); // 68 bytes: fine
  });
});

describe("site address (review fix 8)", () => {
  it("uses NEXT_PUBLIC_SITE_URL, then the Vercel preview address, then localhost in development", () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://pingclean.co.uk/", NODE_ENV: "production" })).toBe("https://pingclean.co.uk");
    expect(resolveSiteUrl({ VERCEL_ENV: "preview", VERCEL_URL: "ping-abc123.vercel.app", NODE_ENV: "production" })).toBe("https://ping-abc123.vercel.app");
    expect(resolveSiteUrl({ NODE_ENV: "development" })).toBe("http://localhost:3000");
  });

  it("never quietly falls back to localhost in production", () => {
    expect(resolveSiteUrl({ NODE_ENV: "production" })).toBeNull();
    expect(resolveSiteUrl({ NODE_ENV: "production", VERCEL_ENV: "production", VERCEL_URL: "ping.vercel.app" })).toBeNull();
    expect(resolveSiteUrl({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "not a url" })).toBeNull();
  });
});

describe("who may choose a new password (final check F1)", () => {
  const now = 1_800_000_000_000;
  const at = (minsAgo: number) => Math.floor((now - minsAgo * 60_000) / 1000);
  const secret = "a-test-secret-that-is-long-enough-000000";
  const sid = "11111111-2222-4333-8444-555555555555";
  const otp = [{ method: "otp", timestamp: at(1) }];
  const session = (over: Partial<{ sessionId: string | null; amr: { method: string; timestamp: number }[] }> = {}) =>
    ({ sessionId: sid, amr: otp, ...over });

  it("lets in the session a reset link created, with its signed pass, for 15 minutes", () => {
    const pass = makeResetPass(sid, secret, now);
    expect(canChooseNewPassword(pass, session(), secret, now)).toBe(true);
    expect(canChooseNewPassword(pass, session({ amr: [{ method: "recovery", timestamp: at(2) }] }), secret, now)).toBe(true); // PKCE link
    expect(canChooseNewPassword(pass, session(), secret, now + 16 * 60_000)).toBe(false); // expired
  });

  it("refuses a forged, unsigned or wrongly signed pass", () => {
    const exp = now + 10 * 60_000;
    expect(canChooseNewPassword(`${sid}.${exp}`, session(), secret, now)).toBe(false); // unsigned
    expect(canChooseNewPassword(`${sid}.${exp}.forged`, session(), secret, now)).toBe(false);
    expect(canChooseNewPassword(makeResetPass(sid, "another-secret-that-is-long-enough-0000", now), session(), secret, now)).toBe(false);
    const genuine = makeResetPass(sid, secret, now);
    const [, , sig] = genuine.split(".");
    expect(canChooseNewPassword(`${sid}.${now + 365 * 86_400_000}.${sig}`, session(), secret, now)).toBe(false); // edited expiry
    expect(canChooseNewPassword("1", session(), secret, now)).toBe(false);
  });

  it("refuses a pass made for another session", () => {
    const pass = makeResetPass("99999999-2222-4333-8444-555555555555", secret, now);
    expect(canChooseNewPassword(pass, session(), secret, now)).toBe(false);
    expect(canChooseNewPassword(makeResetPass(sid, secret, now), session({ sessionId: null }), secret, now)).toBe(false);
  });

  it("refuses a sign-up confirmation (an otp session, but no pass) and a normal sign-in", () => {
    expect(canChooseNewPassword(undefined, session(), secret, now)).toBe(false);
    const pass = makeResetPass(sid, secret, now);
    expect(canChooseNewPassword(pass, session({ amr: [{ method: "password", timestamp: at(1) }] }), secret, now)).toBe(false);
    expect(canChooseNewPassword(pass, session({ amr: [{ method: "otp", timestamp: at(16) }] }), secret, now)).toBe(false);
    expect(freshEmailLink([{ method: "otp", timestamp: at(-60) }], now)).toBe(false); // from the future
    expect(freshEmailLink([{ method: "otp" }], now)).toBe(false);
  });

  it("fails closed in production without a long enough secret", () => {
    expect(resetPassSecret({ NODE_ENV: "production" })).toBeNull();
    expect(resetPassSecret({ NODE_ENV: "production", RESET_PASS_SECRET: "short" })).toBeNull();
    expect(resetPassSecret({ NODE_ENV: "production", RESET_PASS_SECRET: secret })).toBe(secret);
    expect(resetPassSecret({ NODE_ENV: "development" })).toMatch(/^[0-9a-f]{64}$/); // made per server start
    expect(canChooseNewPassword(makeResetPass(sid, secret, now), session(), null, now)).toBe(false);
  });
});

describe("confirm page fields (re-review N7)", () => {
  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  it("takes a token hash with a known type, or a PKCE code", () => {
    expect(parseConfirmForm(fd({ token_hash: "a1b2c3d4e5f6", type: "email", next: "/work/apply", flow: "signup" })).success).toBe(true);
    expect(parseConfirmForm(fd({ code: "0f8a6c2e-1b3d-4e5f-9a7b-112233445566", flow: "reset" })).success).toBe(true);
  });
  it.each([
    ["no token at all", {}],
    ["a hash without a type", { token_hash: "a1b2c3d4e5f6" }],
    ["an unknown type", { token_hash: "a1b2c3d4e5f6", type: "magiclink" }],
    ["odd characters in the hash", { token_hash: "a1b2c3d4'; drop", type: "email" }],
    ["an unknown flow", { code: "abcdefgh1234", flow: "admin" }],
    ["an over-long next", { code: "abcdefgh1234", next: "/" + "a".repeat(600) }],
  ])("refuses %s", (_why, o) => {
    expect(parseConfirmForm(fd(o as Record<string, string>)).success).toBe(false);
  });
});

describe("signed-in-as (re-review N6)", () => {
  it("shows enough of the address to recognise it", () => {
    expect(maskEmail("anna.smith@example.com")).toBe("a•••@example.com");
    expect(maskEmail(null)).toBe("your account");
    expect(maskEmail("@x.com")).toBe("your account");
  });
});

describe("where signed-out visitors go (Track B)", () => {
  it("sends booking and applying to sign-up, everything else to sign-in", () => {
    expect(signedOutEntry("/work/apply")).toBe("/signup");
    expect(signedOutEntry("/account/book")).toBe("/signup");
    expect(signedOutEntry("/account/book/confirm")).toBe("/signup");
    expect(signedOutEntry("/work")).toBe("/login");
    expect(signedOutEntry("/work/apply/extra")).toBe("/login");
    expect(signedOutEntry("/account")).toBe("/login");
    expect(signedOutEntry("/account/bookings")).toBe("/login");
    expect(signedOutEntry("/admin")).toBe("/login");
  });
});
