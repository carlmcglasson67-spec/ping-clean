// Password rules, shared by the live checklist in the browser and the server check.
// Supabase Auth checks again on its side (set its minimum length to match: see the PR).

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 72; // bytes: bcrypt reads only the first 72 bytes, and "é" or an emoji is 2-4

/** Length as bcrypt sees it (UTF-8 bytes), not characters. */
export function passwordBytes(password: string): number {
  return new TextEncoder().encode(password).length;
}

// The handful of passwords people try first. Not a full breach list (Supabase's
// "leaked password protection" on a paid plan covers that), just the obvious ones.
const COMMON = new Set([
  "password", "password1", "password12", "password123", "passw0rd", "qwerty", "qwertyuiop", "qwerty123",
  "123456789", "1234567890", "12345678910", "letmein", "letmein123", "welcome", "welcome1", "welcome123",
  "iloveyou", "admin123", "abc123456", "11111111", "000000000", "cleaning", "cleaner123", "pingclean",
  "pingclean1", "ping123456", "workington", "whitehaven", "cumbria123",
]);

export type PasswordCheck = { id: "length" | "mix" | "common"; label: string; ok: boolean };

/** Each rule, with whether the password meets it. Order is the order shown on screen. */
export function passwordChecks(password: string, email = ""): PasswordCheck[] {
  const lower = password.toLowerCase();
  const local = email.toLowerCase().split("@")[0] ?? "";
  return [
    { id: "length", label: `At least ${PASSWORD_MIN} characters`, ok: password.length >= PASSWORD_MIN && passwordBytes(password) <= PASSWORD_MAX },
    { id: "mix", label: "Letters and at least one number", ok: /[a-z]/i.test(password) && /[0-9]/.test(password) },
    {
      id: "common",
      label: "Not an easy guess (or your email)",
      ok:
        password.length > 0 &&
        !COMMON.has(lower) &&
        new Set(lower).size >= 4 && // "aaaaaaaaaa1", "1212121212" and the like
        !(local.length >= 4 && lower.includes(local)),
    },
  ];
}

/** Null if the password is acceptable, else the first rule it misses, in plain words. */
export function passwordProblem(password: string, email = ""): string | null {
  if (passwordBytes(password) > PASSWORD_MAX) return "That's too long. Use a shorter password (accented letters and emoji count extra).";
  const miss = passwordChecks(password, email).find((c) => !c.ok);
  if (!miss) return null;
  return {
    length: `Use at least ${PASSWORD_MIN} characters.`,
    mix: "Use letters and at least one number.",
    common: "That one's too easy to guess. Try a few words you'll remember, with a number.",
  }[miss.id];
}
