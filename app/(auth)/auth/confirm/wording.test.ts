import { describe, expect, it } from "vitest";
import { LINK_WORDING, linkKind, linkWording } from "./wording";

describe("each email link says what it is (issue #21, note 1)", () => {
  it("tells the kinds of link apart", () => {
    expect(linkKind({ type: "email", flow: "signup" })).toBe("signup");
    expect(linkKind({ type: "signup" })).toBe("signup");
    expect(linkKind({ type: "email" })).toBe("signup"); // magic links read as sign-in confirmation
    expect(linkKind({ type: "recovery" })).toBe("reset");
    expect(linkKind({ flow: "reset" })).toBe("reset"); // a PKCE reset link carries no type
    expect(linkKind({ type: "invite" })).toBe("invite");
    expect(linkKind({ type: "email_change" })).toBe("email_change");
    expect(linkKind({})).toBe("signup");
  });

  it("only a sign-up link says an account was just created", () => {
    for (const kind of ["reset", "invite", "email_change"] as const) {
      expect(JSON.stringify(LINK_WORDING[kind])).not.toMatch(/just created/i);
    }
    expect(linkWording({ type: "email" }).intro).toMatch(/just created a Ping account/);
  });

  it("gives every kind its own title and button", () => {
    const all = Object.values(LINK_WORDING);
    expect(new Set(all.map((w) => w.title)).size).toBe(all.length);
    expect(new Set(all.map((w) => w.button)).size).toBe(all.length);
    expect(linkWording({ type: "invite" }).button).toBe("Accept and choose a password");
    expect(linkWording({ type: "email_change" }).button).toBe("Confirm the change");
  });

  it("keeps the words the existing sign-up and reset links have always had", () => {
    expect(linkWording({ type: "email" }).button).toBe("Confirm my email");
    expect(linkWording({ type: "recovery" }).button).toBe("Continue to reset your password");
  });
});
