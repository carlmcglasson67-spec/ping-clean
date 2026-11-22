import { describe, expect, it } from "vitest";
import { parseConfirmForm } from "./confirm-fields";

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const HASH = "pkce_0123456789abcdef";

describe("the fields /auth/confirm accepts", () => {
  it("takes a token-hash link with its type, and a code link on its own", () => {
    expect(parseConfirmForm(form({ token_hash: HASH, type: "invite" })).success).toBe(true);
    expect(parseConfirmForm(form({ token_hash: HASH, type: "email", flow: "signup" })).success).toBe(true);
    expect(parseConfirmForm(form({ code: HASH })).success).toBe(true);
    expect(parseConfirmForm(form({ code: HASH, flow: "reset" })).success).toBe(true);
  });

  it("refuses a code link that claims a type, so it can't pass itself off as an invite or reset (review S2)", () => {
    for (const type of ["invite", "recovery", "signup", "email", "email_change"]) {
      expect(parseConfirmForm(form({ code: HASH, type })).success).toBe(false);
    }
    expect(parseConfirmForm(form({ code: HASH, token_hash: HASH, type: "invite" })).success).toBe(false);
    expect(parseConfirmForm(form({ code: HASH, token_hash: HASH })).success).toBe(false);
  });

  it("refuses incomplete links and unknown types", () => {
    expect(parseConfirmForm(form({ token_hash: HASH })).success).toBe(false);
    expect(parseConfirmForm(form({ type: "invite" })).success).toBe(false);
    expect(parseConfirmForm(form({ token_hash: HASH, type: "magiclink" })).success).toBe(false);
  });
});
