import { describe, expect, it } from "vitest";
import { safeNext } from "./next";
import { passwordChecks, passwordProblem } from "./password";
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
    ["over 72", "a1".repeat(40), "72 characters"],
  ])("refuses %s", (_why, pw, words) => {
    const problem = passwordProblem(pw, "annasmith@example.com");
    expect(problem).not.toBeNull();
    if (words) expect(problem!.toLowerCase()).toContain(words.toLowerCase());
  });
});
