// Calendar maths on plain "YYYY-MM-DD" dates (UK calendar days, no time zone), Monday first.

export type View = "week" | "month";

function toUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function isYmd(s: string | undefined | null): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return ymd(toUtc(s)) === s; // rejects 2026-02-31
}

export function addDays(day: string, n: number): string {
  const d = toUtc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

/** ISO weekday, Monday = 1. */
export function isoDay(day: string): number {
  return ((toUtc(day).getUTCDay() + 6) % 7) + 1;
}

export function startOfWeek(day: string): string {
  return addDays(day, 1 - isoDay(day));
}

export function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function addMonths(day: string, n: number): string {
  const d = toUtc(startOfMonth(day));
  d.setUTCMonth(d.getUTCMonth() + n);
  return ymd(d);
}

/** The days a view shows: a Monday-to-Sunday week, or whole weeks covering the month. */
export function viewDays(view: View, anchor: string): string[] {
  if (view === "week") {
    const start = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }
  const first = startOfMonth(anchor);
  const start = startOfWeek(first);
  const last = addDays(addMonths(first, 1), -1);
  const end = addDays(startOfWeek(last), 6);
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Where the arrows go. */
export function step(view: View, anchor: string, dir: -1 | 1): string {
  return view === "week" ? addDays(startOfWeek(anchor), 7 * dir) : addMonths(anchor, dir);
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts });

/** "November 2026", or "9–15 November 2026" / "30 Nov – 6 Dec 2026" for a week. */
export function viewTitle(view: View, anchor: string): string {
  if (view === "month") return fmt({ month: "long", year: "numeric" }).format(toUtc(anchor));
  const a = startOfWeek(anchor);
  const b = addDays(a, 6);
  const da = toUtc(a);
  const db = toUtc(b);
  if (a.slice(0, 7) === b.slice(0, 7)) return `${da.getUTCDate()}–${fmt({ day: "numeric", month: "long", year: "numeric" }).format(db)}`;
  if (a.slice(0, 4) === b.slice(0, 4)) return `${fmt({ day: "numeric", month: "short" }).format(da)} – ${fmt({ day: "numeric", month: "short", year: "numeric" }).format(db)}`;
  return `${fmt({ day: "numeric", month: "short", year: "numeric" }).format(da)} – ${fmt({ day: "numeric", month: "short", year: "numeric" }).format(db)}`;
}

/** "Mon", "Tue"… for column heads. */
export function shortWeekday(day: string): string {
  return fmt({ weekday: "short" }).format(toUtc(day));
}

export function dayOfMonth(day: string): number {
  return toUtc(day).getUTCDate();
}

/** "09:30:00" → minutes after midnight. */
export function minutesOf(hms: string): number {
  const [h, m] = hms.split(":").map(Number);
  return h! * 60 + m!;
}

/**
 * Each clean's place in its block ("3 of 8"), counting the cleaner's own cleans in that
 * block by date. Cleans someone else did before a hand-over aren't visible to them, so the
 * count is of the cleans they can see; the total is the block's size.
 */
export function blockPositions(visits: { id: string; series_id: string; scheduled_date: string }[]): Map<string, number> {
  const bySeries = new Map<string, { id: string; scheduled_date: string }[]>();
  for (const v of visits) bySeries.set(v.series_id, [...(bySeries.get(v.series_id) ?? []), v]);
  const out = new Map<string, number>();
  for (const list of bySeries.values()) {
    list.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || a.id.localeCompare(b.id)).forEach((v, i) => out.set(v.id, i + 1));
  }
  return out;
}

/**
 * "Clean n of m" with cancelled cleans left out. Ending a block cancels its future cleans
 * rather than deleting them, so they're skipped when numbering, and taken off the block's
 * size: a block of 8 ended after 3 reads "3 of 3", not "3 of 8".
 */
export function liveBlockPositions(
  visits: { id: string; series_id: string; scheduled_date: string; status: string }[],
  blockSize: (seriesId: string) => number,
): { n: (visitId: string) => number; of: (seriesId: string) => number } {
  const pos = blockPositions(visits.filter((v) => v.status !== "cancelled"));
  const cancelled = new Map<string, number>();
  for (const v of visits) if (v.status === "cancelled") cancelled.set(v.series_id, (cancelled.get(v.series_id) ?? 0) + 1);
  return {
    n: (id) => pos.get(id) ?? 1,
    of: (seriesId) => Math.max(blockSize(seriesId) - (cancelled.get(seriesId) ?? 0), 0),
  };
}
