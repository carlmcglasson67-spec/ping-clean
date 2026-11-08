import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/db/admin";
import { onSetupIntentSucceeded } from "./cards";
import { webhookSecret } from "./keys";
import { MAX_WEBHOOK_BYTES, verifyStripeEvent, type Endpoint } from "./webhooks";

/**
 * What each event type does. Events without a handler are still verified, recorded and
 * acknowledged; later payments PRs add more. A handler must be idempotent: Stripe can
 * deliver an event more than once.
 */
export type Handler = (event: Stripe.Event) => Promise<void>;
export const HANDLERS: Record<Endpoint, Partial<Record<string, Handler>>> = {
  platform: {
    "setup_intent.succeeded": onSetupIntentSucceeded, // PR 4: a card saved at booking
  },
  connect: {},
};

const SECRET_NAME = { platform: "STRIPE_WEBHOOK_SECRET", connect: "STRIPE_CONNECT_WEBHOOK_SECRET" } as const;

const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/**
 * One webhook request, end to end:
 *  1. refuse when the endpoint's secret isn't configured (503, so Stripe retries later);
 *  2. refuse oversized bodies and bad, stale, live-mode or wrong-endpoint events (400/413);
 *  3. record the event id; one already handled is acknowledged and nothing runs again, and
 *     one another copy is still handling is answered 409 so Stripe retries;
 *  4. run its handler (if any); a failure is recorded and answered 500 so Stripe retries.
 * Logs carry only the event id and type, never the payload (it can hold names and emails).
 */
export async function receiveStripeWebhook(request: Request, endpoint: Endpoint): Promise<Response> {
  const secret = webhookSecret(SECRET_NAME[endpoint]);
  if (!secret) {
    console.error(`stripe ${endpoint} webhook: ${SECRET_NAME[endpoint]} is not set`);
    return json(503, { error: "not configured" });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_WEBHOOK_BYTES) return json(413, { error: "too large" });
  const raw = await request.text();

  const verified = verifyStripeEvent(raw, request.headers.get("stripe-signature"), secret, endpoint);
  if (!verified.ok) return json(verified.status, { error: verified.error });
  const event = verified.event;
  const account = (event as { account?: string }).account ?? null;

  let db: ReturnType<typeof createAdminClient>;
  try {
    db = createAdminClient();
  } catch {
    console.error(`stripe ${endpoint} webhook: the server database key isn't configured`);
    return json(503, { error: "not configured" });
  }
  const begun = await db.rpc("stripe_begin_event", { p_event_id: event.id, p_type: event.type, p_account: account });
  if (begun.error) {
    console.error(`stripe ${endpoint} webhook: couldn't record ${event.id}`, begun.error.code);
    return json(500, { error: "try again" });
  }
  const outcome = begun.data?.outcome;
  if (outcome === "duplicate") return json(200, { received: true, duplicate: true });
  // Another copy of this event is being handled right now: not done yet, so not a 2xx.
  // Stripe retries; once that copy finishes the retry is a duplicate, and if it died, the
  // retry takes over after its 5-minute lease.
  if (outcome === "busy") return json(409, { error: "in progress, try again" });
  const lease = begun.data?.lease;
  if (outcome !== "process" || !lease) {
    console.error(`stripe ${endpoint} webhook: unexpected event-log answer for ${event.id}`);
    return json(500, { error: "try again" });
  }

  const handler = HANDLERS[endpoint][event.type];
  try {
    if (handler) await handler(event);
  } catch (e) {
    const reason = e instanceof Error ? e.message.slice(0, 200) : "handler failed";
    // Only clears our own lease: if ours ran out and another copy took over, this does nothing.
    await db.rpc("stripe_finish_event", { p_event_id: event.id, p_lease: lease, p_error: reason });
    console.error(`stripe ${endpoint} webhook: ${event.type} ${event.id} failed`);
    return json(500, { error: "try again" });
  }
  const finished = await db.rpc("stripe_finish_event", { p_event_id: event.id, p_lease: lease, p_error: null });
  if (finished.error) return json(500, { error: "try again" });
  // Our lease ran out and another copy holds the event now. The handler is idempotent, but
  // only the copy holding the lease confirms it: Stripe retries, and gets "duplicate" once
  // that copy has finished.
  if (finished.data !== true) return json(409, { error: "in progress, try again" });
  return json(200, { received: true, handled: Boolean(handler) });
}
