import { describe, expect, it } from "vitest";
import { resolveSiteUrl } from "@/lib/env";
import { safeNext, signedOutEntry } from "./next";
import { passwordBytes, passwordChecks, passwordProblem } from "./password";
import { parseConfirmForm } from "./confirm-fields";
import { maskEmail } from "./mask";
import { freshRecovery } from "./recovery";
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

describe("who may choose a new password (re-review N1)", () => {
  const now = 1_800_000_000_000;
  const at = (minsAgo: number) => Math.floor((now - minsAgo * 60_000) / 1000);
  it("needs a reset link (or one-time code) used in the last 15 minutes, from the signed token", () => {
    expect(freshRecovery([{ method: "recovery", timestamp: at(1) }], now)).toBe(true);
    expect(freshRecovery([{ method: "otp", timestamp: at(14) }], now)).toBe(true);
    expect(freshRecovery([{ method: "password", timestamp: at(30) }, { method: "recovery", timestamp: at(2) }], now)).toBe(true);
  });
  it("refuses a normal sign-in, an email confirmation, an old reset, and anything malformed", () => {
    expect(freshRecovery([{ method: "password", timestamp: at(1) }], now)).toBe(false); // a phone left signed in
    expect(freshRecovery([{ method: "email/signup", timestamp: at(1) }], now)).toBe(false);
    expect(freshRecovery([{ method: "recovery", timestamp: at(16) }], now)).toBe(false); // too old
    expect(freshRecovery([{ method: "recovery", timestamp: at(-60) }], now)).toBe(false); // from the future
    expect(freshRecovery(["recovery"], now)).toBe(false);
    expect(freshRecovery(undefined, now)).toBe(false);
    expect(freshRecovery([{ method: "recovery" }], now)).toBe(false);
  });
  it("has nothing a hand-built cookie could satisfy: the old cookie scheme is gone", async () => {
    const mod = await import("./recovery");
    expect(Object.keys(mod).sort()).toEqual(["RECOVERY_FRESH_MINUTES", "amrEntries", "freshRecovery"]);
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
