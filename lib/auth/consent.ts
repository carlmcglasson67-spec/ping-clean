import { randomBytes } from "node:crypto";

// Versions of the terms and privacy notice a person agreed to. Bump when new wording is
// published, so we always know which version each account accepted.
//
// Recorded when the person chooses their first password (app/(auth)/reset-password), never
// at sign-up: until the email link is used, whoever filled in the sign-up form may not be
// the owner of the address (#60), so their consent and phone number aren't the owner's.
export const TERMS_VERSION = "draft-2026-11";
export const PRIVACY_VERSION = "draft-2026-11";

/**
 * A new account's starting password: 48 random bytes, plus every character class a password
 * rule might ask for. Nobody ever sees it or keeps it; the owner chooses their own after
 * the email link (#60). 68 characters, under bcrypt's 72-byte limit.
 */
export function unguessablePassword(): string {
  return `${randomBytes(48).toString("base64url")}aZ9!`;
}
