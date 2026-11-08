import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/db/admin";
import { webhookSecret } from "./keys";
import { MAX_WEBHOOK_BYTES, verifyStripeEvent, type Endpoint } from "./webhooks";

/**
 * What each event type does. Empty in this PR: the receivers verify, record and acknowledge
 * every event, and later payments PRs add handlers (setup_intent.succeeded in PR 4, …).
 * A handler must be idempotent: Stripe can deliver an event more than once.
 */
export type Handler = (event: Stripe.Event) => Promise<void>;
export const HANDLERS: Record<Endpoint, Partial<Record<string, Handler>>> = { platform: {}, connect: {} };

const SECRET_NAME = { platform: "STRIPE_WEBHOOK_SECRET", connect: "STRIPE_CONNECT_WEBHOOK_SECRET" } as const;

const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/**
 * One webhook request, end to end:
 *  1. refuse when the endpoint's secret isn't configured (503, so Stripe retries later);
 *  2. refuse oversized bodies and bad, stale, live-mode or wrong-endpoint events (400/413);
 *  3. record the event id; one already handled is acknowledged and nothing runs again;
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
  if (begun.data === "done") return json(200, { received: true, duplicate: true });

  const handler = HANDLERS[endpoint][event.type];
  try {
    if (handler) await handler(event);
  } catch (e) {
    const reason = e instanceof Error ? e.message.slice(0, 200) : "handler failed";
    await db.rpc("stripe_finish_event", { p_event_id: event.id, p_error: reason });
    console.error(`stripe ${endpoint} webhook: ${event.type} ${event.id} failed`);
    return json(500, { error: "try again" });
  }
  const finished = await db.rpc("stripe_finish_event", { p_event_id: event.id, p_error: null });
  if (finished.error) return json(500, { error: "try again" });
  return json(200, { received: true, handled: Boolean(handler) });
}
