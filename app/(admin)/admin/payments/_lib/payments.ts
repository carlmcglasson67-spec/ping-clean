// The admin Payments pages: plain-English states, the refund reasons and who carries each,
// and pounds typed by a person turned into whole pence without ever touching a float.

export type Tone = "ok" | "warn" | "bad" | "neutral" | "teal";

export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "About to be charged", tone: "neutral" },
  processing: { label: "Being charged", tone: "neutral" },
  requires_action: { label: "Customer must confirm", tone: "warn" },
  failed: { label: "Failed, will retry", tone: "warn" },
  failed_final: { label: "Unpaid", tone: "bad" },
  succeeded: { label: "Paid", tone: "ok" },
  partially_refunded: { label: "Part refunded", tone: "teal" },
  refunded: { label: "Refunded", tone: "neutral" },
  disputed: { label: "Disputed by their bank", tone: "bad" },
  dispute_lost: { label: "Lost to a dispute", tone: "bad" },
};

export const PAYOUT_STATUS: Record<string, string> = {
  pending: "Waiting to go to their bank",
  held: "Held",
  in_batch: "Sent to their bank",
  paid: "Paid to their bank",
  failed: "Their bank didn't accept it",
  cancelled: "Not being paid",
};

export const REFUND_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "On its way", tone: "warn" },
  succeeded: { label: "Refunded", tone: "ok" },
  failed: { label: "Didn't go through", tone: "bad" },
};

// `on`: what the reason can be given for. The database enforces the same pairing (admin_refund).
export const REFUND_REASONS = [
  { value: "clean_quality", label: "The clean wasn't right", shared: true, on: "clean" },
  { value: "no_show", label: "The cleaner didn't come", shared: true, on: "clean" },
  { value: "fee_waived", label: "Fee waived", shared: true, on: "fee" },
  { value: "ping_error", label: "Ping's mistake", shared: false, on: "both" },
  { value: "goodwill", label: "Goodwill", shared: false, on: "both" },
  { value: "other", label: "Something else", shared: false, on: "both" },
] as const;
/** The reasons offered for a clean's payment, or for a late-cancellation fee. */
export const reasonsFor = (kind: "visit" | "late_cancel") => REFUND_REASONS.filter((r) => r.on === "both" || r.on === (kind === "late_cancel" ? "fee" : "clean"));
export type RefundReason = (typeof REFUND_REASONS)[number]["value"];
export const REASON_LABEL: Record<string, string> = Object.fromEntries(REFUND_REASONS.map((r) => [r.value, r.label]));

export const canRefund = (status: string) => status === "succeeded" || status === "partially_refunded";

/**
 * "12.50", "£12.50", "12", "12.5" → 1250, 1250, 1200, 1250. Whole pence or null: never more
 * than two decimal places, never negative, never a float multiplied by 100.
 */
export function parsePounds(input: string): number | null {
  const m = /^£?\s*(\d{1,5})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const pence = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return Number.isSafeInteger(pence) && pence > 0 ? pence : null;
}

/**
 * Who would carry a refund, shown to the admin before they press the button. The database
 * works out the real split (public.admin_refund) and is the only thing that counts; this
 * mirrors it for a first refund so the preview is honest: Ping's part = refund × fee ÷ price
 * to the nearest penny, in whole-number arithmetic.
 */
export function previewSplit(pence: number, payment: { amount_pence: number; application_fee_pence: number }, shared: boolean): { cleaner: number; ping: number } {
  if (!shared) return { cleaner: 0, ping: pence };
  const ping = Math.min(Math.floor((2 * pence * payment.application_fee_pence + payment.amount_pence) / (2 * payment.amount_pence)), pence);
  return { cleaner: pence - ping, ping };
}
