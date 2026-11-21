// Cloudflare Turnstile on sign-up, sign-in, password reset and "send it again".
//
// Supabase checks the token itself once its CAPTCHA protection is switched on (dashboard →
// Authentication → Attack Protection), using the Turnstile secret pasted there. The app's
// part is to show the widget and pass its token through. Order at go-live: set
// NEXT_PUBLIC_TURNSTILE_SITE_KEY on Vercel and redeploy FIRST, then switch the protection on.
// The other way round, nobody can sign in.

/** The widget's site key, or null when it isn't set (then no widget is shown). */
export function authCaptchaSiteKey(): string | null {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null;
}

/** The token the widget put in the form, if any. Oversized values are dropped. */
export function captchaToken(formData: FormData): string | undefined {
  const t = formData.get("cf-turnstile-response");
  return typeof t === "string" && t.length > 0 && t.length <= 2048 ? t : undefined;
}

/** Supabase refused the request because the check wasn't passed (or no token came). */
export function isCaptchaError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "captcha_failed" || /captcha/i.test(error.message ?? "");
}

export const CAPTCHA_MESSAGE = "Complete the check above the button, then try again.";
