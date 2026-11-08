/** "anna.smith@example.com" → "a•••@example.com": enough to recognise, not to read out. */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "your account";
  const at = email.lastIndexOf("@");
  if (at < 1) return "your account";
  return `${email[0]}•••${email.slice(at)}`;
}
