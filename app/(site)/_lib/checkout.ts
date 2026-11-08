/**
 * Checkout rules the customer's form and the server action share. Pure, so both the
 * browser (live summary) and the server (the real booking) use the same definitions.
 * Prices are never here: the summary multiplies the settings price, and book_series
 * takes its price from the settings table, not from anything this file produces.
 */
import { z } from "zod";
import { BLOCK_SIZE_MAX, BLOCK_SIZE_MIN } from "@/lib/booking";
import { parsePostcode } from "./postcode";
import { MAX_MINUTES, quotePence, STEP_MINUTES } from "./quote";

/** Arrival windows the customer chooses from. The cleaner arrives inside one, then cleans. */
export const ARRIVALS = [
  { id: "early", label: "8–9am", note: "Early start", from: "08:00", to: "09:00" },
  { id: "morning", label: "9–10am", note: "Morning", from: "09:00", to: "10:00" },
  { id: "late-morning", label: "10am–12pm", note: "Late morning", from: "10:00", to: "12:00" },
  { id: "afternoon", label: "12–2pm", note: "Afternoon", from: "12:00", to: "14:00" },
] as const;
export type ArrivalId = (typeof ARRIVALS)[number]["id"];

/** The latest a clean may run to. Keeps every window inside a working day. */
export const LATEST_FINISH = "20:00";

/** Weekly and fortnightly only for now (Carl, round 2). Every four weeks stays in the DB. */
export const FREQUENCIES = [
  { id: "weekly", label: "Every week", days: 7 },
  { id: "fortnightly", label: "Every two weeks", days: 14 },
] as const;
export type FrequencyId = (typeof FREQUENCIES)[number]["id"];

export const DEFAULT_BLOCK = BLOCK_SIZE_MAX;

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};
const toHhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

/**
 * The database's window is the whole span the clean can happen in: from the start of the
 * arrival window to the latest arrival plus the length of the clean.
 * Null when that would run past LATEST_FINISH.
 */
export function cleanWindow(arrival: ArrivalId, durationMinutes: number): { start: string; end: string } | null {
  const a = ARRIVALS.find((x) => x.id === arrival);
  if (!a) return null;
  const end = toMinutes(a.to) + durationMinutes;
  if (end > toMinutes(LATEST_FINISH)) return null;
  return { start: a.from, end: toHhmm(end) };
}

// ---------------------------------------------------------------- dates
const parse = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12));
};
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(ymd: string, days: number): string {
  const d = parse(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return fmt(d);
}

/** ISO weekday (Mon = 1) of a YYYY-MM-DD date. */
export function isoWeekday(ymd: string): number {
  const js = parse(ymd).getUTCDay();
  return js === 0 ? 7 : js;
}

/** Mirrors private.block_first_date(): the first preferred weekday on or after the start. */
export function firstCleanDate(startsOn: string, preferredDay: number): string {
  return addDays(startsOn, (preferredDay - isoWeekday(startsOn) + 7) % 7);
}

/** Mirrors the series_block_end trigger: the planned last clean of the block. */
export function lastCleanDate(startsOn: string, preferredDay: number, frequency: FrequencyId, blockSize: number): string {
  const step = FREQUENCIES.find((f) => f.id === frequency)!.days;
  return addDays(firstCleanDate(startsOn, preferredDay), step * (blockSize - 1));
}

// ---------------------------------------------------------------- money (display only)
/** Price of the whole block, in pence. Integer maths only; book_series stores the real figures. */
export function blockTotalPence(pricePerHourPence: number, durationMinutes: number, blockSize: number): number {
  if (!Number.isSafeInteger(blockSize) || blockSize < BLOCK_SIZE_MIN || blockSize > BLOCK_SIZE_MAX) {
    throw new RangeError(`A block is ${BLOCK_SIZE_MIN} to ${BLOCK_SIZE_MAX} cleans (got ${blockSize})`);
  }
  const total = quotePence(pricePerHourPence, durationMinutes) * blockSize;
  if (!Number.isSafeInteger(total)) throw new RangeError("Block total out of range");
  return total;
}

// ---------------------------------------------------------------- the form
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

/** A new home, as typed. Lengths match the properties table's checks. */
export const homeFields = z.object({
  postcode: z
    .string()
    .transform((v, ctx) => {
      const p = parsePostcode(v);
      if (p.kind !== "full") {
        ctx.addIssue({ code: "custom", message: "Enter your full postcode, like CA14 3XX" });
        return z.NEVER;
      }
      return p.postcode;
    }),
  addressLine1: z.string().trim().min(1, "Enter the first line of your address").max(120),
  addressLine2: optionalText(120),
  town: z.string().trim().min(1, "Enter your town or village").max(60),
  bedrooms: z.coerce.number().int().min(0).max(12),
  bathrooms: z.coerce.number().int().min(0).max(12),
  pets: optionalText(200),
  accessNotes: optionalText(1000),
  keyCode: optionalText(40),
});

/** Everything about the clean, as posted. The window is derived, never posted. */
export const cleanFields = z.object({
  frequency: z.enum(["weekly", "fortnightly"]),
  preferredDay: z.coerce.number().int().min(1).max(7),
  arrival: z.enum(ARRIVALS.map((a) => a.id) as [ArrivalId, ...ArrivalId[]]),
  durationMinutes: z.coerce.number().int().positive().multipleOf(STEP_MINUTES).max(MAX_MINUTES),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
  blockSize: z.coerce.number().int().min(BLOCK_SIZE_MIN).max(BLOCK_SIZE_MAX),
  requestId: z.uuid(),
});

/** "new" for a home typed into the form, or the id of one already on their account. */
export const homeChoice = z.union([z.literal("new"), z.uuid()]);
