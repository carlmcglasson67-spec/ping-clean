import { splitVisitPrice } from "@/lib/money";

/**
 * The customer price for one clean, in pence.
 *
 * Uses lib/money's splitVisitPrice, the exact mirror of private.split_visit_price(),
 * so the instant price can never disagree with what the database stores at booking.
 * The customer price doesn't depend on commission, and the public site never sees the
 * commission, so it's passed as zero here and only pricePence is read.
 * (SHARED-REQUESTS A-2 asks for a named customerPricePence() helper in lib/money.)
 */
export function quotePence(pricePerHourPence: number, durationMinutes: number): number {
  return splitVisitPrice({ pricePerHourPence, durationMinutes, commissionType: "percent", commissionValue: 0 }).pricePence;
}

/** Bookable lengths, in minutes, from the settings minimum up to the schema's limit. */
export const STEP_MINUTES = 30; // series.duration_minutes % 30 = 0
export const MAX_MINUTES = 600; // series.duration_minutes <= 600

export function clampMinutes(minutes: number, minMinutes: number): number {
  const stepped = Math.round(minutes / STEP_MINUTES) * STEP_MINUTES;
  return Math.min(MAX_MINUTES, Math.max(minMinutes, stepped));
}
