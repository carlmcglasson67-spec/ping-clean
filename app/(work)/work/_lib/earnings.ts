// What a cleaner is told about the money for each finished clean. Pure, so it's tested.
// A clean has a payout row only once the customer's payment has gone through (cleaners are
// paid from what's collected); the bank payout it went in gives the arrival date.

export type EarningRow = {
  visitId: string;
  cleanDate: string; // YYYY-MM-DD
  amountPence: number;
  payout: { status: string; available_after: string; paid_at: string | null } | null;
  batch: { status: string; arrival_date: string | null } | null;
};

export type EarningStep = "awaiting_payment" | "checking" | "next_payout" | "sent" | "paid" | "bank_refused" | "held" | "cancelled";

export function earningStep(r: EarningRow, now: Date = new Date()): EarningStep {
  const p = r.payout;
  if (!p) return "awaiting_payment";
  switch (p.status) {
    case "paid": return "paid";
    case "in_batch": return "sent";
    case "failed": return "bank_refused";
    case "held": return "held";
    case "cancelled": return "cancelled";
    default: return new Date(p.available_after).getTime() > now.getTime() ? "checking" : "next_payout";
  }
}

export const EARNING_COPY: Record<EarningStep, { label: string; tone: "ok" | "warn" | "bad" | "neutral" | "teal" }> = {
  awaiting_payment: { label: "Waiting for the customer's payment", tone: "neutral" },
  checking: { label: "In its check period", tone: "neutral" },
  next_payout: { label: "In your next bank payout", tone: "teal" },
  sent: { label: "Sent to your bank", tone: "teal" },
  paid: { label: "Paid", tone: "ok" },
  bank_refused: { label: "Your bank didn't accept it", tone: "bad" },
  held: { label: "On hold", tone: "warn" },
  cancelled: { label: "Not being paid", tone: "neutral" },
};

/** The line under the label: the date that matters for this step, in words. */
export function earningNote(r: EarningRow, step: EarningStep, day: (ymd: string) => string): string {
  switch (step) {
    case "awaiting_payment": return "You're paid once the customer's card has been charged.";
    case "checking": return `Goes to your bank after ${day(r.payout!.available_after.slice(0, 10))}.`;
    case "next_payout": return "Leaves as soon as the money has cleared at Stripe, usually within a few days.";
    case "sent": return r.batch?.arrival_date ? `Should reach your account on ${day(r.batch.arrival_date)}.` : "On its way to your account.";
    case "paid": return r.payout?.paid_at ? `Reached your bank on ${day(r.payout.paid_at.slice(0, 10))}.` : "In your bank.";
    case "bank_refused": return "Check your bank details with Stripe and it's sent again.";
    case "held": return "The Ping office is looking at this one and will be in touch.";
    case "cancelled": return "This clean was refunded in full.";
  }
}

export type EarningTotals = { paidThisMonth: number; onItsWay: number; awaitingPayment: number; refused: number };

/** monthStart: the first instant of this month in London, as an ISO string. */
export function earningTotals(rows: EarningRow[], monthStart: string, now: Date = new Date()): EarningTotals {
  const t: EarningTotals = { paidThisMonth: 0, onItsWay: 0, awaitingPayment: 0, refused: 0 };
  for (const r of rows) {
    const step = earningStep(r, now);
    if (step === "paid") {
      if (r.payout?.paid_at && r.payout.paid_at >= monthStart) t.paidThisMonth += r.amountPence;
    } else if (step === "checking" || step === "next_payout" || step === "sent") t.onItsWay += r.amountPence;
    else if (step === "awaiting_payment") t.awaitingPayment += r.amountPence;
    else if (step === "bank_refused") t.refused += r.amountPence;
  }
  return t;
}

/** The day `days` ago, as YYYY-MM-DD: how far back the earnings list goes. */
export function sinceDay(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}
