import { z } from "zod";

/**
 * A cleaner's working week, as the database stores it (cleaners.availability):
 *   [{ "day": 1-7 (Mon = 1), "from": "HH:MM", "to": "HH:MM" }]
 * One slot per day here. The database allows more, and checks the same shape
 * (private.valid_availability), so a bad value can't break offers for anyone else.
 */
export type Slot = { day: number; from: string; to: string };

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** Half-hour steps from 6am to 9pm: the times a domestic clean can sensibly start or end. */
export const TIMES: string[] = Array.from({ length: (21 - 6) * 2 + 1 }, (_, i) => {
  const mins = 6 * 60 + i * 30;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
});

export const DEFAULT_SLOT = { from: "09:00", to: "15:00" };

export const slotSchema = z
  .object({
    day: z.number().int().min(1).max(7),
    from: z.string().regex(HHMM),
    to: z.string().regex(HHMM),
  })
  .refine((s) => s.from < s.to, { message: "Finish after you start." });

export const availabilitySchema = z
  .array(slotSchema)
  .max(7)
  .refine((a) => new Set(a.map((s) => s.day)).size === a.length, { message: "One set of hours per day." });

/** Postcode districts, as the database checks them (private.valid_districts). */
export const DISTRICT = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;

/** The stored slots by day, for the form. The first slot wins if a day has several. */
export function slotsByDay(availability: unknown): Map<number, Slot> {
  const out = new Map<number, Slot>();
  if (!Array.isArray(availability)) return out;
  for (const raw of availability) {
    const s = slotSchema.safeParse(raw);
    if (s.success && !out.has(s.data.day)) out.set(s.data.day, s.data);
  }
  return out;
}

/**
 * Areas a cleaner may choose: Ping's launch districts, plus any they already cover
 * (so an admin-added district is never silently dropped by saving the form).
 */
export function allowedAreas(launch: readonly string[], current: readonly string[]): string[] {
  return [...new Set([...launch, ...current])].filter((d) => DISTRICT.test(d)).sort(byDistrict);
}

/** CA2 before CA14: letters, then the number as a number. */
export function byDistrict(a: string, b: string): number {
  const pa = a.match(/^([A-Z]+)(\d+)(.*)$/);
  const pb = b.match(/^([A-Z]+)(\d+)(.*)$/);
  if (!pa || !pb) return a.localeCompare(b);
  return pa[1]!.localeCompare(pb[1]!) || Number(pa[2]) - Number(pb[2]) || pa[3]!.localeCompare(pb[3]!);
}

/** The main town in each West Cumbria district, so a cleaner isn't choosing from bare codes. */
export const DISTRICT_TOWN: Record<string, string> = {
  CA13: "Cockermouth",
  CA14: "Workington",
  CA15: "Maryport",
  CA22: "Egremont",
  CA25: "Cleator Moor",
  CA26: "Frizington",
  CA27: "St Bees",
  CA28: "Whitehaven",
};
