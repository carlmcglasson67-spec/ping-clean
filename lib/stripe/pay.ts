import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { createCardUpdateIntent, ensureStripeCustomer, storeSavedCard } from "./cards";
import { readIntent, readStripeError, recordChargeResult, sendCharge, type ChargeResult } from "./charges";
import { getStripe } from "./server";

// The customer sorts a payment themselves (payments PR 8): "Pay now", the bank's confirmation
// step, and "use a different card". Stripe TEST mode only.
//
// Every function takes the signed-in customer's id from the SERVER's session, never from the
// browser, and the database checks the payment is theirs. The amount, the card and the
// cleaner all come from the database. The webhook stays the source of truth: what is
// recorded here is Stripe's own answer, sooner.

export type PayState =
  | { state: "paid" }
  | { state: "needs_bank"; clientSecret: string } // the bank wants the customer to confirm, now
  | { state: "declined"; reason: string }
  | { state: "in_progress" }
  | { state: "no_card" }
  | { state: "unavailable" }; // not theirs, not payable right now, or something went wrong

/** A plain-English line for the bank's reason. Never the raw code. */
export function declineReason(code: string | null): string {
  switch (code) {
    case "insufficient_funds":
      return "Your bank said there wasn't enough money on that card.";
    case "expired_card":
      return "That card has expired.";
    case "lost_card":
    case "stolen_card":
    case "pickup_card":
      return "Your bank has blocked that card.";
    case "incorrect_cvc":
    case "incorrect_number":
      return "The card details didn't match what your bank has.";
    case "payment_intent_authentication_failure":
    case "authentication_required":
      return "Your bank couldn't confirm it was you.";
    default:
      return "Your bank declined the payment. They don't tell us why.";
  }
}

async function settle(paymentId: string, r: ChargeResult, secret: string | null): Promise<PayState> {
  // The bank wants them to confirm and they're here to do it: only note which PaymentIntent
  // it is. If they walk away, the job finds it within 10 minutes and they get the email then.
  if (r.outcome === "requires_action" && secret) {
    await recordChargeResult(createAdminClient(), paymentId, { ...r, outcome: "processing" }, null);
    return { state: "needs_bank", clientSecret: secret };
  }
  const outcome = await recordChargeResult(createAdminClient(), paymentId, r, null);
  if (outcome === "succeeded" || outcome === "already") return { state: "paid" };
  if (outcome === "requires_action") return secret ? { state: "needs_bank", clientSecret: secret } : { state: "unavailable" };
  if (outcome === "failed") return { state: "declined", reason: declineReason(r.error) };
  if (outcome === "ignored" && r.outcome === "processing") return { state: "in_progress" };
  return { state: "unavailable" };
}

/** "Pay now": one more try on the saved card, with the customer present. */
export async function payNow(paymentId: string, customerId: string): Promise<PayState> {
  const db = createAdminClient();
  const begun = await db.rpc("customer_pay_begin", { p_payment: paymentId, p_customer: customerId });
  const row = begun.data?.[0];
  if (begun.error || !row) return { state: "unavailable" };
  if (row.problem === "already_paid") return { state: "paid" };
  if (row.problem === "in_progress") return { state: "in_progress" };
  if (row.problem === "no_card") return { state: "no_card" };
  if (row.problem) return { state: "unavailable" };

  try {
    const pi = await sendCharge(row, true);
    return await settle(paymentId, readIntent(pi), pi.client_secret);
  } catch (e) {
    const read = readStripeError(e);
    if (read.kind === "answer") {
      const pi = (e as { payment_intent?: { client_secret?: string | null }; raw?: { payment_intent?: { client_secret?: string | null } } });
      return settle(paymentId, read.result, pi.payment_intent?.client_secret ?? pi.raw?.payment_intent?.client_secret ?? null);
    }
    if (read.kind === "refused" && row.mode === "create") {
      await db.rpc("charge_not_sent", { p_payment: paymentId, p_error: read.error });
    }
    // (Already moved on at Stripe, most likely paid: left for the job's check to record.)
    if (read.kind === "refused" && row.mode === "retry" && read.error !== "stripe_payment_intent_unexpected_state") {
      await db.rpc("charge_retry_not_sent", { p_payment: paymentId, p_error: read.error, p_customer_try: true });
    }
    // Otherwise left as 'processing': the job asks Stripe what happened within 10 minutes.
    console.error(`pay now: payment ${paymentId} couldn't be sent`);
    return { state: "unavailable" };
  }
}

/** After the bank's confirmation step: ask Stripe how it went and record it. */
export async function checkPayment(paymentId: string, customerId: string): Promise<PayState> {
  const db = createAdminClient();
  const known = await db.rpc("customer_payment_intent", { p_payment: paymentId, p_customer: customerId });
  if (known.error || typeof known.data !== "string" || !known.data) return { state: "unavailable" };
  try {
    const pi = await getStripe().paymentIntents.retrieve(known.data);
    const r = readIntent(pi);
    // Still waiting on the bank step: nothing to record, show it again.
    if (r.outcome === "requires_action") return pi.client_secret ? { state: "needs_bank", clientSecret: pi.client_secret } : { state: "unavailable" };
    return await settle(paymentId, r, pi.client_secret);
  } catch {
    console.error(`pay now: payment ${paymentId} couldn't be checked`);
    return { state: "unavailable" };
  }
}

/** "Use a different card": a SetupIntent for the block this payment belongs to. */
export async function startCardChange(
  paymentId: string,
  customer: { id: string; email: string | null; fullName: string | null },
): Promise<string | null> {
  const series = await createAdminClient().rpc("customer_card_series", { p_payment: paymentId, p_customer: customer.id });
  if (series.error || typeof series.data !== "string") return null;
  const stripeCustomer = await ensureStripeCustomer(customer);
  const si = await createCardUpdateIntent(series.data, stripeCustomer, customer.id);
  return si.client_secret;
}

const SETUP_INTENT = /^seti_[A-Za-z0-9_]{6,64}$/;

/**
 * The card form says the new card is saved: fetch that SetupIntent from Stripe and store the
 * card now, without waiting for the webhook, so "Pay now" uses it. Only a SetupIntent that
 * belongs to this customer's own Stripe customer is believed.
 */
export async function confirmCardChange(setupIntentId: string, customerId: string): Promise<boolean> {
  if (!SETUP_INTENT.test(setupIntentId)) return false;
  const mine = await createAdminClient().rpc("stripe_customer_for", { p_profile: customerId });
  if (mine.error || typeof mine.data !== "string" || !mine.data) return false;
  try {
    const si = await getStripe().setupIntents.retrieve(setupIntentId);
    const owner = typeof si.customer === "string" ? si.customer : si.customer?.id;
    if (owner !== mine.data || si.metadata?.profile_id !== customerId) return false;
    return (await storeSavedCard(si)) === "saved";
  } catch {
    console.error("card change: couldn't confirm");
    return false;
  }
}
