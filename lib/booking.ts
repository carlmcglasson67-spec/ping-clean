// What a booking request may contain, checked on the server before calling
// public.book_series. The database re-checks every rule against the settings table and
// never takes a price from here: there is no price field to send.
import { z } from "zod";

/** Carl's rule: every booking is a block of 1 to 8 cleans. The database enforces it too. */
export const BLOCK_SIZE_MIN = 1;
export const BLOCK_SIZE_MAX = 8;

const time = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Use HH:MM");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const bookSeriesInput = z
  .object({
    propertyId: z.uuid(),
    frequency: z.enum(["weekly", "fortnightly", "four_weekly"]),
    preferredDay: z.number().int().min(1).max(7), // ISO, Monday = 1
    windowStart: time,
    windowEnd: time,
    durationMinutes: z.number().int().positive().multipleOf(30).max(600),
    startsOn: date,
    blockSize: z.number().int().min(BLOCK_SIZE_MIN).max(BLOCK_SIZE_MAX),
    requestId: z.uuid(), // made once per checkout, so a double tap books once
  })
  .strict()
  .refine((b) => b.windowEnd > b.windowStart, { message: "The window must end after it starts", path: ["windowEnd"] });

export type BookSeriesInput = z.infer<typeof bookSeriesInput>;

/** The RPC arguments for public.book_series, in the database's names. */
export function bookSeriesArgs(input: BookSeriesInput) {
  return {
    p_property: input.propertyId,
    p_frequency: input.frequency,
    p_preferred_day: input.preferredDay,
    p_window_start: input.windowStart,
    p_window_end: input.windowEnd,
    p_duration_minutes: input.durationMinutes,
    p_starts_on: input.startsOn,
    p_block_size: input.blockSize,
    p_request_id: input.requestId,
  };
}
