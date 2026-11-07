import "server-only";

// Cloudflare Turnstile, optional. Switched on only when BOTH keys are set:
//   NEXT_PUBLIC_TURNSTILE_SITE_KEY   the widget on the form (public)
//   TURNSTILE_SECRET_KEY             checked here, on the server (never NEXT_PUBLIC_)
// With both missing, the check is skipped and the form works without a widget. With only
// one set, it's also off, and a warning is logged so a half-done setup gets noticed.

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type Env = Record<string, string | undefined>;

let warned = false;
let warnedHosts = false;
let warnedOff = false;

export function turnstileEnabled(env: Env = process.env, warn: (msg: string) => void = console.warn): boolean {
  const site = Boolean(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
  const secret = Boolean(env.TURNSTILE_SECRET_KEY);
  if (site !== secret && !warned) {
    warned = true;
    warn(`Turnstile is OFF: only ${site ? "NEXT_PUBLIC_TURNSTILE_SITE_KEY" : "TURNSTILE_SECRET_KEY"} is set. Set both to switch it on.`);
  }
  return site && secret;
}

/** For tests: let the warnings fire again. */
export function resetTurnstileWarning() {
  warned = false;
  warnedHosts = false;
  warnedOff = false;
}

const isProduction = (env: Env) => env.NODE_ENV === "production" && env.VERCEL_ENV !== "preview";

/** The site key for the widget, or null when Turnstile is off (then render no widget). */
export function turnstileSiteKey(env: Env = process.env): string | null {
  return turnstileEnabled(env) ? env.NEXT_PUBLIC_TURNSTILE_SITE_KEY! : null;
}

const hostOf = (value: string | undefined): string | null => {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    return null;
  }
};

/**
 * The hostnames a token may come from: Ping's own site, plus the preview's own addresses on
 * a Vercel preview. Empty in local development (no check).
 */
export function turnstileHostnames(env: Env = process.env): Set<string> {
  const hosts = [hostOf(env.NEXT_PUBLIC_SITE_URL)];
  if (env.VERCEL_ENV === "preview") hosts.push(hostOf(env.VERCEL_URL), hostOf(env.VERCEL_BRANCH_URL));
  return new Set(hosts.filter((h): h is string => Boolean(h)));
}

export type TurnstileResult = "passed" | "off" | "failed" | "unavailable";

/**
 * Checks the widget's token with Cloudflare, and that it was solved on Ping's own site.
 * No IP address is sent or stored.
 * "unavailable" means Cloudflare couldn't be reached: the caller asks the person to try
 * again rather than letting the submission through.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  { env = process.env, fetchImpl = fetch, timeoutMs = 5000 }: { env?: Env; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<TurnstileResult> {
  if (!turnstileEnabled(env)) {
    if (isProduction(env) && !warnedOff) {
      warnedOff = true;
      console.warn("Turnstile is OFF in production: register interest is protected only by the honeypot and the firewall rule.");
    }
    return "off";
  }
  // Switched on, so a token is required: a bot posting the Server Action straight to any
  // route (Next forwards it) without solving the widget is refused here.
  if (!token || token.length > 2048) return "failed";
  const allowed = turnstileHostnames(env);
  if (allowed.size === 0 && isProduction(env)) {
    // Fail closed: in production we must know which site a token may come from.
    if (!warnedHosts) {
      warnedHosts = true;
      console.warn("Turnstile check refused: NEXT_PUBLIC_SITE_URL isn't set, so the allowed hostname is unknown.");
    }
    return "failed";
  }
  try {
    const res = await fetchImpl(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!, response: token }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return "unavailable";
    const data = (await res.json()) as { success?: unknown; hostname?: unknown };
    if (data.success !== true) return "failed";
    if (allowed.size > 0 && !(typeof data.hostname === "string" && allowed.has(data.hostname))) return "failed";
    return "passed";
  } catch {
    return "unavailable";
  }
}
