import type { Tables } from "@/lib/db/types";

// The numbers booking can't run without: the same list as private.settings_ready() in
// supabase/migrations/…_bookings.sql. Booking stays off until every one is set.
export const REQUIRED_SETTINGS: { key: keyof Tables<"settings">; label: string }[] = [
  { key: "price_per_hour_pence", label: "Customer price per hour" },
  { key: "min_booking_minutes", label: "Minimum booking length" },
  { key: "commission_type", label: "Commission: percentage or per hour" },
  { key: "commission_value", label: "Commission amount" },
  { key: "top_window_minutes", label: "How long Top cleaners see a job first" },
  { key: "approved_window_minutes", label: "How long before it opens to everyone" },
  { key: "unclaimed_alert_minutes", label: "When to alert you about an unclaimed job" },
  { key: "dispute_window_hours", label: "Check period before a cleaner is paid" },
  { key: "launch_districts", label: "Launch postcode areas" },
];

export function missingSettings(settings: Partial<Tables<"settings">> | null | undefined) {
  return REQUIRED_SETTINGS.filter(({ key }) => {
    const v = settings?.[key];
    return v === null || v === undefined || (Array.isArray(v) && v.length === 0);
  });
}
