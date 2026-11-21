import { describe, expect, it } from "vitest";
import { captchaToken, isCaptchaError } from "./captcha";

describe("auth captcha", () => {
  it("reads the widget's token from the form", () => {
    const f = new FormData();
    expect(captchaToken(f)).toBeUndefined();
    f.set("cf-turnstile-response", "abc");
    expect(captchaToken(f)).toBe("abc");
    f.set("cf-turnstile-response", "x".repeat(2049));
    expect(captchaToken(f)).toBeUndefined();
  });

  it("recognises Supabase's captcha refusal and nothing else", () => {
    expect(isCaptchaError({ code: "captcha_failed" })).toBe(true);
    expect(isCaptchaError({ message: "captcha verification process failed" })).toBe(true);
    expect(isCaptchaError({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe(false);
    expect(isCaptchaError(null)).toBe(false);
  });
});
