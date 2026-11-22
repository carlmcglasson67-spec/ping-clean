/**
 * What each kind of email link says on /auth/confirm (issue #21, note 1). One place, so a
 * new kind of link can't fall back to "You've just created a Ping account" by accident.
 *
 *   reset         type=recovery, or a PKCE link from the reset form (flow=reset)
 *   invite        type=invite: someone was invited, and chooses a password next
 *   email_change  type=email_change: one of the links sent when an address changes
 *   signup        everything else (sign-up confirmation, flow=signup, magic links)
 */
export type LinkKind = "signup" | "reset" | "invite" | "email_change";

export function linkKind(p: { type?: string; flow?: string }): LinkKind {
  if (p.type === "recovery" || p.flow === "reset") return "reset";
  if (p.type === "invite") return "invite";
  if (p.type === "email_change") return "email_change";
  return "signup";
}

export type LinkWording = {
  eyebrow: string;
  /** The big statement: first line, then the gradient line. */
  statement: [string, string];
  lede: string;
  title: string;
  intro: string;
  button: string;
};

export const LINK_WORDING: Record<LinkKind, LinkWording> = {
  signup: {
    eyebrow: "Nearly there",
    statement: ["One tap", "and you’re in."],
    lede: "Press confirm to finish setting up your Ping account. This shows us the email address really is yours.",
    title: "Confirm your email",
    intro: "You've just created a Ping account. Confirm it's yours and we'll take you in.",
    button: "Confirm my email",
  },
  reset: {
    eyebrow: "New password",
    statement: ["One tap,", "then a new password."],
    lede: "Press continue to choose a new password for your Ping account.",
    title: "Reset your password",
    intro: "You asked to reset your Ping password. If that wasn't you, close this page: nothing will change.",
    button: "Continue to reset your password",
  },
  invite: {
    eyebrow: "You're invited",
    statement: ["One tap,", "then pick a password."],
    lede: "Press accept to join Ping. Next you'll choose the password you'll sign in with.",
    title: "Accept your invitation",
    intro: "You've been invited to Ping. Accept it with this email address, then choose a password for your account.",
    button: "Accept and choose a password",
  },
  email_change: {
    eyebrow: "New email address",
    statement: ["One tap", "to make it official."],
    lede: "Press confirm to change the email address on your Ping account.",
    title: "Confirm your email change",
    intro: "You asked to change the email address you use for Ping. If that wasn't you, close this page and nothing will change, then sign in and change your password.",
    button: "Confirm the change",
  },
};

export const linkWording = (p: { type?: string; flow?: string }): LinkWording => LINK_WORDING[linkKind(p)];
