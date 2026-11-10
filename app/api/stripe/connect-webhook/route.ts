import { receiveStripeWebhook } from "@/lib/stripe/receive";

// Stripe → Ping, for cleaners' connected-account events (account updates, payouts).
// Signature-checked with STRIPE_CONNECT_WEBHOOK_SECRET; see lib/stripe/receive.ts.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return receiveStripeWebhook(request, "connect");
}
