// Ping runs on UK time. Dates in the database are plain calendar dates (no zone);
// "today" is always today in Europe/London, whatever the server's clock zone.
const TZ = "Europe/London";

/** Today's date in London as YYYY-MM-DD. */
export function todayInLondon(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** First day of this month in London as YYYY-MM-DD. */
export function monthStartInLondon(now: Date = new Date()): string {
  return `${todayInLondon(now).slice(0, 8)}01`;
}

function parseDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12));
}

/** "2026-11-09" → "Monday 9 November". Adds the year only when it isn't this year. */
export function formatDay(ymd: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatToParts(parseDate(ymd));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const sameYear = ymd.slice(0, 4) === todayInLondon(now).slice(0, 4);
  const base = `${get("weekday")} ${get("day")} ${get("month")}`;
  return sameYear ? base : `${base} ${get("year")}`;
}

/** Today / Tomorrow / the day name, for lists people scan. */
export function relativeDay(ymd: string, now: Date = new Date()): string {
  const today = todayInLondon(now);
  const diff = Math.round((parseDate(ymd).getTime() - parseDate(today).getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return formatDay(ymd, now);
}

/** "09:00:00" → "9am", "13:30" → "1.30pm" (UK style). */
export function formatTime(hms: string): string {
  const [hStr, mStr] = hms.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}.${String(m).padStart(2, "0")}${suffix}`;
}

export function formatWindow(start: string, end: string): string {
  return `${formatTime(start)}–${formatTime(end)}`;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** ISO weekday (Mon = 1) → "Monday". */
export function weekdayName(iso: number): string {
  const name = WEEKDAYS[iso - 1];
  if (!name) throw new RangeError(`Not an ISO weekday: ${iso}`);
  return name;
}

/** "2026-11-06T14:03:00Z" → "6 Nov, 2.03pm" in London time. */
export function formatStamp(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${day}, ${formatTime(time)}`;
}
