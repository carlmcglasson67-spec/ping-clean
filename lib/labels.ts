import type { Enums } from "@/lib/db/types";

// Plain-English labels for every status a person sees. One place, so the three apps
// never describe the same thing differently.

export const FREQUENCY: Record<Enums<"series_frequency">, string> = {
  weekly: "Every week",
  fortnightly: "Every two weeks",
  four_weekly: "Every four weeks",
};

export const VISIT_STATUS: Record<Enums<"visit_status">, { label: string; tone: "neutral" | "signal" | "ok" | "warn" | "bad" | "mist" }> = {
  scheduled: { label: "Booked", tone: "mist" },
  in_progress: { label: "Cleaning now", tone: "signal" },
  completed: { label: "Done", tone: "ok" },
  skipped: { label: "Skipped", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  no_show: { label: "Missed", tone: "bad" },
};

export const SERIES_STATUS: Record<Enums<"series_status">, { label: string; tone: "neutral" | "signal" | "ok" | "warn" | "bad" | "mist" }> = {
  offering: { label: "Finding your cleaner", tone: "warn" },
  unclaimed: { label: "Finding your cleaner", tone: "warn" },
  claimed: { label: "Cleaner confirmed", tone: "ok" },
  paused: { label: "Paused", tone: "neutral" },
  ended: { label: "Ended", tone: "neutral" },
};

export const TIER: Record<Enums<"cleaner_tier">, string> = {
  new: "New",
  approved: "Approved",
  top: "Top",
};

export const DOCUMENT_KIND: Record<Enums<"document_kind">, string> = {
  dbs: "DBS check",
  insurance: "Public liability insurance",
  photo_id: "Photo ID",
  right_to_work: "Right to work",
};

export const DOCUMENT_STATUS: Record<Enums<"document_status">, { label: string; tone: "neutral" | "ok" | "warn" | "bad" }> = {
  pending: { label: "Being checked", tone: "warn" },
  verified: { label: "Verified", tone: "ok" },
  rejected: { label: "Needs replacing", tone: "bad" },
  expired: { label: "Expired", tone: "bad" },
};
