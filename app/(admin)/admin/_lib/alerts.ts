// The engine's alerts in the Ping team's words: what happened and what to do about it.
// Kinds come from the engine_alerts check constraint (supabase/migrations/…_blocks.sql).

export type AlertKind =
  | "visit_needs_cover"
  | "visit_no_show"
  | "visit_unfinished"
  | "block_stalled"
  | "block_overlap"
  | "block_closed"
  | "release_failed"
  | "generate_failed";

export const ALERT_KIND: Record<AlertKind, { label: string; short: string; todo: string; urgent: boolean }> = {
  visit_needs_cover: {
    label: "Needs cover today",
    short: "Needs cover",
    todo: "A block went back on the board with a clean booked for today. Find cover, or call the customer.",
    urgent: true,
  },
  visit_no_show: {
    label: "Clean missed",
    short: "Missed",
    todo: "A booked clean passed without being started. Check with the cleaner and the customer.",
    urgent: true,
  },
  visit_unfinished: {
    label: "Clean never finished",
    short: "Unfinished",
    todo: "A clean was started but never marked complete. Check what happened with the cleaner.",
    urgent: true,
  },
  block_stalled: {
    label: "Block stalled",
    short: "Stalled",
    todo: "The block's dates have passed with cleans never booked. Agree with the customer, then end it or put it back on the board.",
    urgent: false,
  },
  block_overlap: {
    label: "Block cut short",
    short: "Cut short",
    todo: "This block ran into the next one booked at the same home. Agree with the customer what happens to the lost cleans.",
    urgent: false,
  },
  block_closed: {
    label: "Block closed by Ping",
    short: "Closed",
    todo: "The block had no cleans left to give, so it was closed. Check whether the customer wants to book again.",
    urgent: false,
  },
  release_failed: {
    label: "Offers didn't go out",
    short: "Offers failed",
    todo: "The engine couldn't offer this job to cleaners. Assign it by hand, and tell the main session.",
    urgent: false,
  },
  generate_failed: {
    label: "Cleans weren't booked",
    short: "Booking failed",
    todo: "The nightly job couldn't book this block's cleans. Tell the main session.",
    urgent: false,
  },
};

export const ALERT_ORDER = Object.keys(ALERT_KIND) as AlertKind[];

export function alertKind(kind: string): AlertKind | null {
  return kind in ALERT_KIND ? (kind as AlertKind) : null;
}
