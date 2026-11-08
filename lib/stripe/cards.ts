import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/db/admin";
import { getStripe } from "./server";

/**
 * The customer's one Stripe customer (C13): made the first time they save a card, then
 * reused for every block. Idempotent on Stripe's side too (key profile:<id>:customer), and
 * the database keeps the first id if two checkouts race.
 */
export async function ensureStripeCustomer(profile: { id: string; email: string | null; fullName: string | null }): Promise<string> {
  const db = createAdminClient();
  const known = await db.rpc("stripe_customer_for", { p_profile: profile.id });
  if (known.error) throw new Error("couldn't read the saved customer");
  if (typeof known.data === "string" && known.data) return known.data;

  const customer = await getStripe().customers.create(
    {
      ...(profile.email ? { email: profile.email } : {}),
      ...(profile.fullName ? { name: profile.fullName } : {}),
      metadata: { profile_id: profile.id },
    },
    { idempotencyKey: `profile:${profile.id}:customer` },
  );
  const kept = await db.rpc("stripe_link_customer", { p_profile: profile.id, p_stripe_customer: customer.id });
  if (kept.error || typeof kept.data !== "string") throw new Error("couldn't save the customer");
  return kept.data;
}

/**
 * A SetupIntent for one block: saves a card for later charges (off_session), takes no
 * money. Idempotent per block (key series:<id>:setup), so a double click or a refresh gets
 * the same one back. The block id travels in metadata for the webhook, which checks it.
 */
export async function createSetupIntent(seriesId: string, stripeCustomerId: string, profileId: string): Promise<Stripe.SetupIntent> {
  return getStripe().setupIntents.create(
    {
      customer: stripeCustomerId,
      usage: "off_session",
      allowed_payment_method_types: ["card"], // cards only (this API version's name for it)
      metadata: { series_id: seriesId, profile_id: profileId },
    },
    { idempotencyKey: `series:${seriesId}:setup` },
  );
}

const SERIES_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * setup_intent.succeeded: the card is saved. The block and customer come from Stripe (the
 * signed event, then the payment method fetched from Stripe itself), never from a browser,
 * and the database checks the Stripe customer really belongs to that block's customer.
 * A mismatch or an ended block stores nothing and isn't retried (it would never succeed).
 */
export async function onSetupIntentSucceeded(event: Stripe.Event): Promise<void> {
  const si = event.data.object as Stripe.SetupIntent;
  const seriesId = si.metadata?.series_id;
  const customer = typeof si.customer === "string" ? si.customer : si.customer?.id;
  const pmId = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
  if (si.status !== "succeeded" || !seriesId || !SERIES_ID.test(seriesId) || !customer || !pmId) {
    console.warn(`stripe: setup_intent.succeeded ${event.id} is missing what Ping needs; ignored`);
    return;
  }
  const pm = await getStripe().paymentMethods.retrieve(pmId);
  const pmCustomer = typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
  if (pmCustomer !== customer || pm.type !== "card" || !pm.card) {
    console.warn(`stripe: setup_intent.succeeded ${event.id}: the card isn't attached to that customer; ignored`);
    return;
  }
  const saved = await createAdminClient().rpc("stripe_card_saved", {
    p_series: seriesId,
    p_stripe_customer: customer,
    p_payment_method: pm.id,
    p_brand: pm.card.brand,
    p_last4: pm.card.last4,
    p_exp_month: pm.card.exp_month,
    p_exp_year: pm.card.exp_year,
  });
  if (saved.error) throw new Error("couldn't save the card"); // retried by Stripe
  if (saved.data !== "saved") console.warn(`stripe: setup_intent.succeeded ${event.id}: ${saved.data}; nothing stored`);
}
