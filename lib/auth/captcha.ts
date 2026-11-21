// Cloudflare Turnstile on sign-up, sign-in, password reset and "send it again".
//
// Supabase checks the token itself once its CAPTCHA protection is switched on (dashboard →
// Authentication → Attack Protection), using the Turnstile secret pasted there. The app's
// part is to show the widget and pass its token through.
//
// Go-live order (intent/go-live/plan.md, step 9a):
//  1. This code is on main and production is deployed WITH NEXT_PUBLIC_TURNSTILE_SITE_KEY set
//     (the key is baked in at build time). Any deployment built without it, or from a branch
//     without this code, can't sign anyone in once protection is on, previews included
//     while they share the live Supabase project.
//  2. Only then switch the protection on. The secret pasted into Supabase must be the one
//     that belongs to the same widget as the site key (the existing TURNSTILE_SECRET_KEY).
// Supabase does not check the hostname a token came from (lib/interest/turnstile.ts does for
// the interest form), so the widget's allowed hostnames in Cloudflare are the only limit:
// add preview domains there if the widget should load on them. Automated sign-in checks on
// a preview with its own Supabase project should use Cloudflare's always-pass test keys.
//
// This needs only the public key; the interest form shows its widget only when both keys
// are set (turnstileSiteKey) because it checks the token itself. That difference is meant.

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

/** Supabase wanted a token and the page sent none: an old page or a build without the key. */
export const CAPTCHA_NO_WIDGET = "Sign-in has just been updated. Refresh the page, then try again.";

/** The message for a captcha refusal: refresh if the page never showed the check at all. */
export function captchaMessage(formData: FormData): string {
  return captchaToken(formData) ? CAPTCHA_MESSAGE : CAPTCHA_NO_WIDGET;
}
