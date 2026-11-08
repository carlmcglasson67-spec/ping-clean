import type { Enums } from "@/lib/db/types";

const STEP: Record<Enums<"series_frequency">, number> = { weekly: 7, fortnightly: 14, four_weekly: 28 };

function toUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}
const toYmd = (d: Date) => d.toISOString().slice(0, 10);

/** "2026-12-23" → "23 Dec". For the block's last clean, where the weekday is already known. */
export function formatShortDay(ymd: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(toUtc(ymd));
}

/**
 * The first visit a cleaner would do if they claimed now. Mirrors the engine
 * (private.generate_visits_for_series): the first preferred weekday on or after the
 * start date, then every 7, 14 or 28 days, never today or earlier.
 */
export function firstVisitDate(startsOn: string, preferredDay: number, frequency: Enums<"series_frequency">, today: string): string {
  const start = toUtc(startsOn);
  const isoDow = ((start.getUTCDay() + 6) % 7) + 1;
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + ((preferredDay - isoDow + 7) % 7));
  while (toYmd(d) <= today) d.setUTCDate(d.getUTCDate() + STEP[frequency]);
  return toYmd(d);
}
