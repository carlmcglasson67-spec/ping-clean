"use server";

// The customer's "sort a payment" page: pay now, the bank's confirmation step, and using a
// different card. Each action takes the customer from the server's session; the payment id
// from the browser is only ever used to look up a payment that is theirs (lib/stripe/pay.ts).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/env";
import { publishableKey, secretKeyProblem } from "@/lib/stripe/keys";
import { checkPayment, confirmCardChange, payNow, startCardChange, type PayState } from "@/lib/stripe/pay";

export type PayView = PayState & { publishableKey?: string };
export type CardChange = { ok: true; clientSecret: string; publishableKey: string } | { ok: false };

const id = z.uuid();
const OFF: PayView = { state: "unavailable" };

async function customer() {
  if (secretKeyProblem(process.env.STRIPE_SECRET_KEY) || !hasSupabaseEnv()) return null;
  const session = await getSession();
  return session && session.role === "customer" ? session : null;
}

function view(paymentId: string, r: PayState): PayView {
  if (r.state === "paid") {
    revalidatePath("/account");
    revalidatePath(`/account/pay/${paymentId}`);
  }
  if (r.state !== "needs_bank") return r;
  const pk = publishableKey();
  return pk ? { ...r, publishableKey: pk } : OFF;
}

export async function payNowAction(paymentId: string): Promise<PayView> {
  const parsed = id.safeParse(paymentId);
  const me = await customer();
  if (!parsed.success || !me) return OFF;
  return view(parsed.data, await payNow(parsed.data, me.userId));
}

export async function checkPaymentAction(paymentId: string): Promise<PayView> {
  const parsed = id.safeParse(paymentId);
  const me = await customer();
  if (!parsed.success || !me) return OFF;
  return view(parsed.data, await checkPayment(parsed.data, me.userId));
}

export async function startCardChangeAction(paymentId: string): Promise<CardChange> {
  const parsed = id.safeParse(paymentId);
  const me = await customer();
  const pk = publishableKey();
  if (!parsed.success || !me || !pk) return { ok: false };
  try {
    const secret = await startCardChange(parsed.data, { id: me.userId, email: me.email, fullName: me.fullName });
    return secret ? { ok: true, clientSecret: secret, publishableKey: pk } : { ok: false };
  } catch {
    console.error("card change: couldn't start"); // no ids or personal data in logs
    return { ok: false };
  }
}

export async function confirmCardChangeAction(paymentId: string, setupIntentId: string): Promise<{ ok: boolean }> {
  const parsed = id.safeParse(paymentId);
  const me = await customer();
  if (!parsed.success || !me || typeof setupIntentId !== "string") return { ok: false };
  const ok = await confirmCardChange(setupIntentId, me.userId);
  if (ok) revalidatePath(`/account/pay/${parsed.data}`);
  return { ok };
}
