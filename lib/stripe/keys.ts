// Stripe keys and addresses: TEST MODE ONLY (ping-money-rules 8). Pure checks, no Stripe
// client here, so they can be unit-tested and used before anything talks to Stripe.
// Live keys stay off until Kate signs off the agent model, VAT and the cleaner terms.

type Env = Record<string, string | undefined>;

const SECRET_TEST = /^(sk|rk)_test_[A-Za-z0-9]{10,255}$/;
const PUBLISHABLE_TEST = /^pk_test_[A-Za-z0-9]{10,255}$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9+/=]{10,255}$/;

/** Why a secret key can't be used (never echoes the key), or null when it's a test key. */
export function secretKeyProblem(key: string | undefined): string | null {
  if (!key) return "STRIPE_SECRET_KEY is not set.";
  if (/^(sk|rk)_live_/.test(key)) return "STRIPE_SECRET_KEY is a LIVE key. Ping only runs on Stripe test mode until Kate signs off.";
  if (!SECRET_TEST.test(key)) return "STRIPE_SECRET_KEY isn't a Stripe test key (sk_test_… or rk_test_…).";
  return null;
}

/** The publishable key for the browser, or null if it isn't a test key. */
export function publishableKey(env: Env = process.env): string | null {
  const k = env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  return k && PUBLISHABLE_TEST.test(k) ? k : null;
}

/** A webhook signing secret, or null if missing or malformed. */
export function webhookSecret(name: "STRIPE_WEBHOOK_SECRET" | "STRIPE_CONNECT_WEBHOOK_SECRET", env: Env = process.env): string | null {
  const s = env[name];
  return s && WEBHOOK_SECRET.test(s) ? s : null;
}

/**
 * Where the Stripe client sends requests. Normally Stripe itself. For tests only, a fake
 * on this machine (STRIPE_API_BASE=http://127.0.0.1:port): any other address is refused,
 * so a misconfigured setting can't send the key somewhere else.
 */
export function apiBase(env: Env = process.env): { host: string; port: number; protocol: "http" | "https" } | null {
  const raw = env.STRIPE_API_BASE;
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("STRIPE_API_BASE isn't a URL.");
  }
  if (!["127.0.0.1", "localhost"].includes(u.hostname) || !["http:", "https:"].includes(u.protocol)) {
    throw new Error("STRIPE_API_BASE may only point at a test fake on this machine (127.0.0.1 or localhost).");
  }
  return { host: u.hostname, port: Number(u.port || (u.protocol === "https:" ? 443 : 80)), protocol: u.protocol === "https:" ? "https" : "http" };
}
