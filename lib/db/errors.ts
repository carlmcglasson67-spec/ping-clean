// The database's own error codes (raised by booking, claiming and the visit-day functions)
// in the plain words the apps show. One list, so every surface says the same thing.
// Codes and meanings: intent/blocks/plan.md and the comments in supabase/migrations.

export const PING_ERRORS = {
  // Claiming (engine)
  PC001: "That job isn't available to you.",
  PC002: "Another cleaner claimed this one first.",
  PC003: "That job is no longer open to you.",
  PC004: "That job can't go ahead on its dates any more.",
  PC005: "That block has already ended.",
  PC007: "The customer hasn't saved a card for this block yet.",
  // The visit day
  PC010: "That clean isn't yours.",
  PC011: "That clean is booked for another day.",
  PC012: "That clean has already finished or isn't going ahead.",
  PC013: "Tick every item, or mark it “couldn't do” with a reason.",
  PC014: "Add at least one before and one after photo.",
  PC015: "No checklist has been set up yet. Call the Ping office.",
  PC016: "That clean has payment records, so it can't be removed. Cancel it instead.",
  PC017: "This block is on hold, so this clean isn't going ahead. Ping will tell you when it's back on.",
  // Booking
  PC020: "Booking isn't open yet.",
  PC021: "That home isn't on your account.",
  PC022: "We don't clean in that area yet.",
  PC023: "That length of clean isn't available.",
  PC024: "The first clean has to be after today.",
  PC025: "A booking is 1 to 8 cleans.",
  PC026: "That day or time isn't valid.",
  PC027: "You already have cleans booked at this home on those dates.",
  PC028: "That booking was already made with different details. Start the booking again.",
  PC029: "There's a payment to sort out before you book again. You'll find it in My cleans.",
  // Money (state checks: these mean a bug or a replayed event, never the person's mistake)
  PC040: "That payment has already moved on. Refresh to see where it stands.",
  PC041: "That payout has already moved on. Refresh to see where it stands.",
  PC042: "Refunds can't add up to more than was paid.",
  PC043: "That payout doesn't match a paid charge for this clean.",
  PC044: "That charge doesn't match the clean it's for.",
  PC045: "Payment records are kept for good and can't be removed.",
  PC046: "That payment record has to start at the beginning.",
  PC047: "That refund has already moved on. Refresh to see where it stands.",
  PC036: "That reason doesn't fit this payment.",
  PC048: "That payment can't be refunded.",
  // Cleaner decisions (the Ping team)
  PC052: "The four checks aren't all verified and in date yet.",
  PC053: "That cleaner has already moved on. Refresh to see where they stand.",
  // Register interest
  PC030: "Enter a full UK postcode, like CA14 3XX.",
  PC031: "Enter an email address or a UK mobile number.",
  PC032: "We're not taking names for the waiting list just now. Please try again later.",
  PC033: "Something went wrong. Please try again.",
  PC034: "That clean can't be cancelled now. If it's today, call the Ping office.",
  PC035: "The cost of cancelling has changed since this page loaded. Check the new figure and confirm again.",
} as const;

export type PingErrorCode = keyof typeof PING_ERRORS;

const FALLBACK = "Something went wrong. Please try again.";

/**
 * Check constraints a person can run into (an admin saving settings), by constraint name.
 * Postgres reports these as 23514 with the name in the message; only the name is matched,
 * and the database's own text is never shown.
 */
export const CHECK_MESSAGES: Record<string, string> = {
  settings_late_cancel_fee_min: "A late-cancellation fee has to be at least 30p (card payments can't be smaller), or left empty for no fee.",
  settings_late_cancel_share: "A fixed share needs the cleaner's share of the late fee.",
  settings_late_cancel_share_follows_split:
    "The cleaner's share only applies with a fixed share. Clear it, or choose a fixed share.",
};

/** Plain words for an error from a Supabase RPC call. Never shows raw database text. */
export function pingErrorMessage(error: { code?: string | null; message?: string | null } | null | undefined): string {
  const code = error?.code;
  if (code && code in PING_ERRORS) return PING_ERRORS[code as PingErrorCode];
  if (code === "23514") {
    const name = /check constraint "([a-z0-9_]+)"/.exec(error?.message ?? "")?.[1];
    if (name && name in CHECK_MESSAGES) return CHECK_MESSAGES[name]!;
  }
  if (code === "42501") return "You don't have access to do that.";
  return FALLBACK;
}

/** True when the error is one of Ping's own codes (worth showing to the person as is). */
export function isPingError(error: { code?: string | null } | null | undefined): error is { code: PingErrorCode } {
  return !!error?.code && error.code in PING_ERRORS;
}
