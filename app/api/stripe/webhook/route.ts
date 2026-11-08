import { receiveStripeWebhook } from "@/lib/stripe/receive";

// Stripe → Ping, for Ping's own account events (cards, charges, refunds, disputes).
// Signature-checked with STRIPE_WEBHOOK_SECRET; see lib/stripe/receive.ts.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return receiveStripeWebhook(request, "platform");
}
