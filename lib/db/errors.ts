// The database's own error codes (raised by booking, claiming and the visit-day functions)
// in the plain words the apps show. One list, so every surface says the same thing.
// Codes and meanings: intent/blocks/plan.md and the comments in supabase/migrations.

export const PING_ERRORS = {
  // Claiming (engine)
  PC001: "That job isn't available to you.",
  PC002: "Another cleaner claimed this one first.",
  PC003: "That job is no longer open to you.",
  // The visit day
  PC010: "That clean isn't yours.",
  PC011: "That clean is booked for another day.",
  PC012: "That clean has already finished or isn't going ahead.",
  PC013: "Tick every item, or mark it “couldn't do” with a reason.",
  PC014: "Add at least one before and one after photo.",
  PC015: "No checklist has been set up yet. Call the Ping office.",
  // Booking
  PC020: "Booking isn't open yet.",
  PC021: "That home isn't on your account.",
  PC022: "We don't clean in that area yet.",
  PC023: "That length of clean isn't available.",
  PC024: "The first clean has to be after today.",
  PC025: "A booking is 1 to 8 cleans.",
  PC026: "That day or time isn't valid.",
} as const;

export type PingErrorCode = keyof typeof PING_ERRORS;

const FALLBACK = "Something went wrong. Please try again.";

/** Plain words for an error from a Supabase RPC call. Never shows raw database text. */
export function pingErrorMessage(error: { code?: string | null } | null | undefined): string {
  const code = error?.code;
  if (code && code in PING_ERRORS) return PING_ERRORS[code as PingErrorCode];
  if (code === "42501") return "You don't have access to do that.";
  return FALLBACK;
}

/** True when the error is one of Ping's own codes (worth showing to the person as is). */
export function isPingError(error: { code?: string | null } | null | undefined): error is { code: PingErrorCode } {
  return !!error?.code && error.code in PING_ERRORS;
}
