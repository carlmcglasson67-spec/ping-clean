"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";
import { formatPence } from "@/lib/money";
import { sendRefund } from "@/lib/stripe/refunds";
import { adminErrorMessage, NOT_SAVED, type ActionResult } from "../_lib/errors";
import { pgUuid } from "../_lib/ids";
import { parsePounds, REFUND_REASONS } from "./_lib/payments";

const input = z.object({
  paymentId: pgUuid,
  pounds: z.string().trim().max(12),
  reason: z.enum(REFUND_REASONS.map((r) => r.value) as [string, ...string[]], { message: "Choose why this is being refunded." }),
  note: z.string().trim().max(300, "Keep the note to 300 characters.").optional(),
});

/**
 * Refunds all or part of a paid clean. The database (public.admin_refund) checks the caller
 * is an admin, that the money is there to refund, and works out who carries it from the
 * reason; nothing about the split comes from the browser. Then it's sent to Stripe once.
 */
export async function refundPayment(raw: unknown): Promise<ActionResult> {
  await requireRole("admin", "/admin/payments");
  const p = input.safeParse(raw);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? NOT_SAVED };
  const pence = parsePounds(p.data.pounds);
  if (pence === null) return { ok: false, message: "Type the amount in pounds and pence, like 12.50." };

  const supabase = await createClient();
  const asked = await supabase.rpc("admin_refund", { p_payment: p.data.paymentId, p_amount_pence: pence, p_reason: p.data.reason, p_note: p.data.note || "" });
  if (asked.error || typeof asked.data !== "string") return { ok: false, message: adminErrorMessage(asked.error) };

  const outcome = await sendRefund(asked.data);
  revalidatePath("/admin", "layout");
  switch (outcome) {
    case "succeeded": return { ok: true, message: `${formatPence(pence)} refunded. It reaches the customer's card in 5 to 10 days.` };
    case "pending": return { ok: true, message: `${formatPence(pence)} is on its way back. Stripe is still processing it; this page updates when it's done.` };
    case "failed": return { ok: false, message: "Stripe wouldn't make that refund, so nothing has gone back. There's an alert on Jobs with the reason." };
    default: return { ok: true, message: `${formatPence(pence)} refund recorded. Stripe couldn't be reached just now; it's sent automatically within the hour.` };
  }
}
