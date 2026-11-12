"use server";

// Card saving at booking (A-4): the Server Action Track A's card step calls.
//
//   const r = await startCardSetup(seriesId);        → Stripe's card form (account/_components/card-form)
//   await confirmCardSetup(setupIntent.id);          → the server asks Stripe, then stores the card
//
// The card is saved only on Stripe's say-so: the setup_intent.succeeded webhook, or the
// server fetching the SetupIntent from Stripe itself. Never because the browser says so.
// Nothing is charged.
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";
import { hasSupabaseEnv } from "@/lib/env";
import { createSetupIntent, ensureStripeCustomer } from "./cards";
import { createSetupLink, ensureCleanerAccount, syncAccountStatus } from "./connect";
import { publishableKey, secretKeyProblem } from "./keys";
import { confirmCardChange } from "./pay";

export type CardSetup =
  | { ok: true; clientSecret: string; publishableKey: string }
  | { ok: false; error: string };

const SERIES_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_YET = "Card saving isn't switched on yet. We'll ask for your card before your first clean.";
const TRY_AGAIN = "We couldn't open the card form just now. Please try again.";

export async function startCardSetup(seriesId: string): Promise<CardSetup> {
  if (typeof seriesId !== "string" || !SERIES_ID.test(seriesId)) return { ok: false, error: TRY_AGAIN };
  const pk = publishableKey();
  if (!pk || secretKeyProblem(process.env.STRIPE_SECRET_KEY) || !hasSupabaseEnv()) return { ok: false, error: NOT_YET };

  const session = await getSession();
  if (!session || session.role !== "customer") return { ok: false, error: "Sign in to save your card." };

  // Their own block, still going: RLS returns nothing for anyone else's.
  const supabase = await createClient();
  const { data: s } = await supabase.from("series").select("id, status").eq("id", seriesId).maybeSingle();
  if (!s || s.status === "ended") return { ok: false, error: "That booking isn't open any more." };

  try {
    const customer = await ensureStripeCustomer({ id: session.userId, email: session.email, fullName: session.fullName });
    const si = await createSetupIntent(s.id, customer, session.userId);
    if (!si.client_secret) return { ok: false, error: TRY_AGAIN };
    return { ok: true, clientSecret: si.client_secret, publishableKey: pk };
  } catch {
    console.error("card setup: couldn't start"); // no ids or personal data in logs
    return { ok: false, error: TRY_AGAIN };
  }
}

/**
 * The card form says the card is saved. The server fetches that SetupIntent from Stripe
 * itself, checks it belongs to this customer, and stores the card now, so the page can say
 * "Card saved" without waiting for the webhook (which records the same thing again).
 */
export async function confirmCardSetup(setupIntentId: string): Promise<{ ok: boolean }> {
  if (typeof setupIntentId !== "string" || secretKeyProblem(process.env.STRIPE_SECRET_KEY) || !hasSupabaseEnv()) return { ok: false };
  const session = await getSession();
  if (!session || session.role !== "customer") return { ok: false };
  return { ok: await confirmCardChange(setupIntentId, session.userId) };
}

// ---------------------------------------------------------------- cleaners: payments set-up
// The cleaner app's "Set up payments" button and its two return routes call these.
//
//   const r = await startPaymentsSetup();   if (r.ok) redirect(r.url)   → Stripe's own form
//   await refreshPaymentsStatus();          on the way back from Stripe
//
// Only an approved (active) cleaner, and only ever for their own account: the id never comes
// from the browser. "Ready" is set only from what Stripe itself says (lib/stripe/connect.ts).

export type PaymentsSetup = { ok: true; url: string } | { ok: false; error: string };

const SETUP_NOT_YET = "Payments set-up isn't switched on yet. We'll tell you as soon as it is.";
const SETUP_TRY_AGAIN = "We couldn't open Stripe just now. Check your signal and try again.";

async function activeCleaner(): Promise<{ id: string; email: string | null } | null> {
  const session = await getSession();
  if (!session || session.role !== "cleaner") return null;
  const supabase = await createClient();
  const { data } = await supabase.from("cleaners").select("status").eq("id", session.userId).maybeSingle();
  return data?.status === "active" ? { id: session.userId, email: session.email } : null;
}

export async function startPaymentsSetup(): Promise<PaymentsSetup> {
  if (secretKeyProblem(process.env.STRIPE_SECRET_KEY) || !hasSupabaseEnv()) return { ok: false, error: SETUP_NOT_YET };
  const cleaner = await activeCleaner();
  if (!cleaner) return { ok: false, error: "Payments set-up opens once the Ping team has approved you." };
  try {
    const account = await ensureCleanerAccount(cleaner);
    return { ok: true, url: await createSetupLink(account) };
  } catch {
    console.error("payments set-up: couldn't start"); // no ids or personal data in logs
    return { ok: false, error: SETUP_TRY_AGAIN };
  }
}

/** Back from Stripe: read the cleaner's own account now, without waiting for the webhook. */
export async function refreshPaymentsStatus(): Promise<void> {
  if (secretKeyProblem(process.env.STRIPE_SECRET_KEY) || !hasSupabaseEnv()) return;
  const cleaner = await activeCleaner();
  if (!cleaner) return;
  try {
    const known = await createAdminClient().rpc("stripe_cleaner_account_for", { p_cleaner: cleaner.id });
    if (typeof known.data === "string" && known.data) await syncAccountStatus(known.data);
  } catch {
    console.error("payments set-up: couldn't refresh"); // the webhook will still bring it up to date
  }
}
