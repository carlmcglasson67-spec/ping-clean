// Checking a Stripe webhook before anything is believed (ping-money-rules 7).
// No network and no key needed: only the endpoint's signing secret.
import Stripe from "stripe";

export type Endpoint = "platform" | "connect";

/** Webhook bodies are small; anything bigger isn't from Stripe. */
export const MAX_WEBHOOK_BYTES = 512 * 1024;
/** How old a signature may be (Stripe's default): stops a captured request being replayed later. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type Verified =
  | { ok: true; event: Stripe.Event }
  | { ok: false; status: 400 | 413; error: string };

/**
 * Verifies the Stripe-Signature header against the raw body and the endpoint's secret, then
 * refuses anything Ping must never act on:
 *  - live-mode events (Ping runs on Stripe test mode only);
 *  - a Connect event on the platform endpoint, or a platform event on the Connect endpoint
 *    (each endpoint has its own secret and its own events).
 */
export function verifyStripeEvent(
  rawBody: string,
  signature: string | null,
  secret: string,
  endpoint: Endpoint,
  nowMs?: number, // for tests: "now" in milliseconds
): Verified {
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) return { ok: false, status: 413, error: "too large" };
  if (!signature) return { ok: false, status: 400, error: "missing signature" };
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(rawBody, signature, secret, SIGNATURE_TOLERANCE_SECONDS, undefined, nowMs);
  } catch {
    return { ok: false, status: 400, error: "bad signature" };
  }
  if (event.livemode) return { ok: false, status: 400, error: "live-mode event refused" };
  if (typeof event.id !== "string" || !/^evt_[A-Za-z0-9_]{6,64}$/.test(event.id)) return { ok: false, status: 400, error: "bad event id" };
  const account = (event as { account?: unknown }).account;
  if (endpoint === "platform" && account !== undefined && account !== null) return { ok: false, status: 400, error: "connect event on platform endpoint" };
  if (endpoint === "connect" && (typeof account !== "string" || !/^acct_[A-Za-z0-9]{6,64}$/.test(account))) {
    return { ok: false, status: 400, error: "platform event on connect endpoint" };
  }
  return { ok: true, event };
}
