import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/db/admin";
import type { Database } from "@/lib/db/types";
import { getStripe } from "./server";

// Charging a clean once it's complete (payments PR 6). Stripe TEST mode only.
//
// The database decides what is due (charge_claim) and is the only place a payment's state
// changes (stripe_payment_result). This file only talks to Stripe and reports what it said:
//   * one PaymentIntent per payment row, ever (idempotency key payment:<id>);
//   * a destination charge on the cleaner's behalf: the customer buys the clean from the
//     cleaner, and Ping's fee is split off (ping-money-rules 5);
//   * a retry confirms the same PaymentIntent again; it never makes a new one;
//   * the webhook is the source of truth (ping-money-rules 7). What the job records straight
//     away is the same answer, sooner.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTENT_ID = /^pi_[A-Za-z0-9_]{6,64}$/;

export type Outcome = "succeeded" | "requires_action" | "failed" | "processing";

/** What Stripe said about one charge, in the shape the database checks. */
export type ChargeResult = {
  intentId: string;
  outcome: Outcome;
  amount: number;
  fee: number | null;
  destination: string | null;
  chargeId: string | null;
  error: string | null;
};

const idOf = (x: string | { id: string } | null | undefined): string | null => (typeof x === "string" ? x : (x?.id ?? null));

/** Stripe's error codes are short and lower_snake; anything else is not stored. */
function errorCode(code: string | null | undefined, fallback: string): string {
  return code && /^[a-z0-9_]{1,80}$/.test(code) ? code : fallback;
}

/**
 * Reads a PaymentIntent. "The bank wants the customer to confirm" arrives two ways: as a
 * requires_action status, or (off-session, the usual case here) as a failed try whose error
 * is authentication_required. Both mean the same to Ping: wait for the customer.
 */
export function readIntent(pi: Stripe.PaymentIntent): ChargeResult {
  const lastError = pi.last_payment_error?.code ?? null;
  let outcome: Outcome;
  let error: string | null = null;
  switch (pi.status) {
    case "succeeded":
      outcome = "succeeded";
      break;
    case "processing":
      outcome = "processing";
      break;
    case "requires_action":
    case "requires_confirmation":
      outcome = "requires_action";
      break;
    case "canceled":
      outcome = "failed";
      error = "canceled";
      break;
    default: // requires_payment_method (the try failed), or anything Stripe adds later
      if (lastError === "authentication_required") outcome = "requires_action";
      else {
        outcome = "failed";
        error = errorCode(pi.last_payment_error?.decline_code ?? lastError, "payment_failed");
      }
  }
  return {
    intentId: pi.id,
    outcome,
    amount: pi.amount,
    fee: pi.application_fee_amount ?? null,
    destination: idOf(pi.transfer_data?.destination as string | { id: string } | null | undefined),
    chargeId: idOf(pi.latest_charge as string | { id: string } | null),
    error,
  };
}

/**
 * Reads a thrown Stripe error. A declined card comes back as an error that carries the
 * PaymentIntent: that's an answer about the charge. An error without one (Stripe refused the
 * request, or couldn't be reached) says nothing was charged, or that we don't know.
 */
export function readStripeError(e: unknown): { kind: "answer"; result: ChargeResult } | { kind: "refused"; error: string } | { kind: "unknown" } {
  const err = e as { type?: string; code?: string; payment_intent?: Stripe.PaymentIntent; raw?: { payment_intent?: Stripe.PaymentIntent } };
  const pi = err?.payment_intent ?? err?.raw?.payment_intent;
  if (pi && typeof pi.id === "string" && INTENT_ID.test(pi.id)) return { kind: "answer", result: readIntent(pi) };
  // Stripe understood the request and said no (a bad parameter, an account that can't be a
  // destination): sending it again would get the same answer.
  if (err?.type === "StripeInvalidRequestError" || err?.type === "StripeCardError") {
    return { kind: "refused", error: `stripe_${errorCode(err.code, "invalid_request")}` };
  }
  return { kind: "unknown" }; // network, rate limit, Stripe down: the try is picked up again later
}

type Claimed = Database["public"]["Functions"]["charge_claim"]["Returns"][number];

async function send(row: Claimed): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();
  if (row.mode === "check" && row.payment_intent_id) return stripe.paymentIntents.retrieve(row.payment_intent_id);
  if (!row.stripe_customer_id || !row.payment_method_id || !row.cleaner_account_id) throw new Error("claimed charge is missing its card or cleaner");
  if (row.mode === "retry" && row.payment_intent_id) {
    return stripe.paymentIntents.confirm(
      row.payment_intent_id,
      { payment_method: row.payment_method_id, off_session: true },
      { idempotencyKey: `${row.idempotency_key}:confirm:${row.attempt}` },
    );
  }
  return stripe.paymentIntents.create(
    {
      amount: row.amount_pence,
      currency: "gbp",
      customer: row.stripe_customer_id,
      payment_method: row.payment_method_id,
      allowed_payment_method_types: ["card"], // cards only, so Stripe never needs a page to send the customer back to
      off_session: true, // the customer isn't there: the clean has just finished
      confirm: true,
      on_behalf_of: row.cleaner_account_id, // the cleaner is the seller
      transfer_data: { destination: row.cleaner_account_id },
      application_fee_amount: row.application_fee_pence, // Ping's fee, split off by Stripe
      metadata: { payment_id: row.payment_id, visit_id: row.visit_id },
    },
    { idempotencyKey: row.idempotency_key },
  );
}

type Db = ReturnType<typeof createAdminClient>;

/** Hands Stripe's answer to the database, which checks it and decides what changes. */
async function record(db: Db, paymentId: string, r: ChargeResult, eventAt: Date | null): Promise<string> {
  const saved = await db.rpc("stripe_payment_result", {
    p_payment: paymentId,
    p_intent: r.intentId,
    p_outcome: r.outcome,
    p_amount: r.amount,
    p_fee: r.fee,
    p_destination: r.destination,
    p_charge: r.chargeId,
    p_error: r.error,
    p_event_at: eventAt ? eventAt.toISOString() : null,
  });
  if (saved.error || typeof saved.data !== "string") throw new Error("couldn't record the payment result");
  return saved.data;
}

export type ChargeRun = { claimed: number; succeeded: number; failed: number; needsCustomer: number; waiting: number; errors: number };

/**
 * One run of the charge job: take what's due, send each to Stripe, record each answer.
 * One charge going wrong never stops the others. Logs carry ids and outcomes only.
 */
export async function runChargeJob(limit = 10): Promise<ChargeRun> {
  const db = createAdminClient();
  const run: ChargeRun = { claimed: 0, succeeded: 0, failed: 0, needsCustomer: 0, waiting: 0, errors: 0 };
  const claimed = await db.rpc("charge_claim", { p_limit: limit });
  if (claimed.error) throw new Error("couldn't read the charges that are due");
  const rows: Claimed[] = claimed.data ?? [];
  run.claimed = rows.length;

  for (const row of rows) {
    try {
      let result: ChargeResult;
      try {
        result = readIntent(await send(row));
      } catch (e) {
        const read = readStripeError(e);
        if (read.kind === "refused" && row.mode === "create") {
          const noted = await db.rpc("charge_not_sent", { p_payment: row.payment_id, p_error: read.error });
          if (noted.error) throw new Error("couldn't record the refused charge");
          run.failed++;
          console.warn(`charge job: payment ${row.payment_id} refused by Stripe (${read.error})`);
          continue;
        }
        if (read.kind !== "answer") throw e;
        result = read.result;
      }
      const outcome = await record(db, row.payment_id, result, null);
      if (outcome === "succeeded" || outcome === "already") run.succeeded++;
      else if (outcome === "failed") run.failed++;
      else if (outcome === "requires_action") run.needsCustomer++;
      else if (outcome === "mismatch" || outcome === "unknown") {
        run.errors++;
        console.error(`charge job: payment ${row.payment_id}: Stripe's answer didn't match the row (${outcome})`);
      } else run.waiting++;
    } catch {
      // Left as 'processing': picked up again in 10 minutes with the same idempotency key,
      // and the webhook records the outcome if the charge did go through.
      run.errors++;
      console.error(`charge job: payment ${row.payment_id} (${row.mode}) couldn't be sent or recorded`);
    }
  }
  return run;
}

const EVENT_OUTCOME: Record<string, Outcome | undefined> = {
  "payment_intent.succeeded": "succeeded",
  "payment_intent.payment_failed": "failed",
  "payment_intent.requires_action": "requires_action",
  "payment_intent.canceled": "failed",
};

/**
 * payment_intent.* (Ping's own account endpoint). The payment is named in the PaymentIntent's
 * metadata, which Ping set; the database still checks the PaymentIntent, amount, fee and
 * destination against that row before anything changes. PaymentIntents that aren't Ping's
 * charges are acknowledged and ignored. A database failure throws, so Stripe retries.
 */
export async function onPaymentIntentEvent(event: Stripe.Event): Promise<void> {
  const fromEvent = EVENT_OUTCOME[event.type];
  const pi = event.data.object as Stripe.PaymentIntent;
  const paymentId = pi?.metadata?.payment_id;
  if (!fromEvent || !pi || !INTENT_ID.test(String(pi.id)) || !paymentId || !UUID.test(paymentId)) {
    console.warn(`stripe: ${event.type} ${event.id} isn't one of Ping's charges; ignored`);
    return;
  }
  const result = readIntent(pi);
  // The event's own type wins over the status in its snapshot, except that a failed try
  // asking for the customer's bank confirmation is "needs the customer", not "failed".
  if (fromEvent === "succeeded") result.outcome = "succeeded";
  else if (fromEvent === "requires_action") result.outcome = "requires_action";
  else if (result.outcome !== "requires_action") {
    result.outcome = "failed";
    result.error = result.error ?? (event.type === "payment_intent.canceled" ? "canceled" : "payment_failed");
  }
  const outcome = await record(createAdminClient(), paymentId, result, new Date(event.created * 1000));
  if (outcome === "mismatch" || outcome === "unknown") console.warn(`stripe: ${event.type} ${event.id}: ${outcome}; nothing recorded`);
}

/** The shared secret the database's cron sends with each kick: 32+ characters, or the job is off. */
export function jobSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.PING_JOB_SECRET;
  return s && s.length >= 32 && s.length <= 256 ? s : null;
}

/** "Authorization: Bearer <secret>", compared in constant time. */
export function jobRequestAllowed(header: string | null, secret: string): boolean {
  const given = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}
