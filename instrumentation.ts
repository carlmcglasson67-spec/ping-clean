// Runs once when the server starts. Checks the settings Ping can't work safely without,
// so a bad setup shows in the logs straight away instead of at someone's first reset.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const { resetPassSecret, RESET_SECRET_PROBLEM } = await import("@/lib/auth/recovery");
  if (!resetPassSecret()) console.error(`[ping] ${RESET_SECRET_PROBLEM}`);
}
