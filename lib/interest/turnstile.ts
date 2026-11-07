import "server-only";

// Cloudflare Turnstile, optional. Switched on only when BOTH keys are set:
//   NEXT_PUBLIC_TURNSTILE_SITE_KEY   the widget on the form (public)
//   TURNSTILE_SECRET_KEY             checked here, on the server (never NEXT_PUBLIC_)
// With either missing, the check is skipped and the form works without a widget.

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type Env = Record<string, string | undefined>;

export function turnstileEnabled(env: Env = process.env): boolean {
  return Boolean(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);
}

/** The site key for the widget, or null when Turnstile is off (then render no widget). */
export function turnstileSiteKey(env: Env = process.env): string | null {
  return turnstileEnabled(env) ? env.NEXT_PUBLIC_TURNSTILE_SITE_KEY! : null;
}

export type TurnstileResult = "passed" | "off" | "failed" | "unavailable";

/**
 * Checks the widget's token with Cloudflare. No IP address is sent or stored.
 * "unavailable" means Cloudflare couldn't be reached: the caller asks the person to try
 * again rather than letting the submission through.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  { env = process.env, fetchImpl = fetch, timeoutMs = 5000 }: { env?: Env; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<TurnstileResult> {
  if (!turnstileEnabled(env)) return "off";
  if (!token || token.length > 2048) return "failed";
  try {
    const res = await fetchImpl(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!, response: token }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return "unavailable";
    const data = (await res.json()) as { success?: unknown };
    return data.success === true ? "passed" : "failed";
  } catch {
    return "unavailable";
  }
}
