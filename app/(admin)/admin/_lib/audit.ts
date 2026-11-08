// One line per audit entry for the "Recent changes" list. The log never holds personal data
// (redacted columns are stored as "changed"), and this only ever shows which fields moved.

const ENTITY: Record<string, string> = {
  settings: "Settings",
  cleaners: "Cleaner",
  cleaner_documents: "Document",
  series: "Block",
  visits: "Visit",
  payments: "Payment",
  payouts: "Payout",
  visit_qc: "QC score",
  profiles: "Account role",
  engine_alerts: "Alert",
  series_billing: "Card on file",
  interest_signups: "Interest list",
};

const ACTION: Record<string, string> = {
  insert: "created",
  delete: "removed",
  export: "exported",
  view_list: "list opened",
  view_counts: "counts opened",
  purge: "expired entries deleted",
};

// Field names in words, for the ones people change most.
const FIELD: Record<string, string> = {
  status: "status",
  tier: "tier",
  cleaner_id: "cleaner",
  resolved_at: "resolved",
  resolved_by: "resolved",
  notified_at: "told",
  price_per_hour_pence: "price",
  commission_value: "commission",
  commission_type: "commission type",
  score: "score",
  couldnt_do_count: "couldn't-do items",
  claimed_at: "claimed",
  completed_at: "completed",
  started_at: "started",
};

export function auditEntity(entity: string) {
  return ENTITY[entity] ?? entity.replace(/_/g, " ");
}

export function auditSummary(action: string, detail: unknown): string {
  if (action in ACTION) return ACTION[action]!;
  const keys = detail && typeof detail === "object" ? Object.keys(detail).filter((k) => k !== "visit_id") : [];
  const words = [...new Set(keys.map((k) => FIELD[k] ?? k.replace(/_/g, " ")))];
  return words.length ? `changed: ${words.slice(0, 4).join(", ")}${words.length > 4 ? "…" : ""}` : "changed";
}
