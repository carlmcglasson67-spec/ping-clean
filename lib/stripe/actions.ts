"use server";

// Card saving at booking (A-4): the Server Action Track A's card step calls.
//
//   const r = await startCardSetup(seriesId);
//   if (r.ok) → <Elements stripe={loadStripe(r.publishableKey)} options={{ clientSecret: r.clientSecret }}>
//              <PaymentElement /> … stripe.confirmSetup({ elements, confirmParams: { return_url } })
//
// The card is saved only when Stripe's setup_intent.succeeded webhook arrives
// (lib/stripe/cards.ts), never because the browser says so. Nothing is charged.
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";
import { hasSupabaseEnv } from "@/lib/env";
import { createSetupIntent, ensureStripeCustomer } from "./cards";
import { publishableKey, secretKeyProblem } from "./keys";

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
