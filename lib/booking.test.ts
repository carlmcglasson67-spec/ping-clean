import { describe, expect, it } from "vitest";
import { bookSeriesArgs, bookSeriesInput } from "./booking";
import { isPingError, pingErrorMessage } from "./db/errors";

const valid = {
  propertyId: "00000000-0000-4000-b000-000000000002",
  frequency: "fortnightly",
  preferredDay: 3,
  windowStart: "10:00",
  windowEnd: "14:00",
  durationMinutes: 120,
  startsOn: "2026-11-20",
  blockSize: 4,
  requestId: "6f1c2b9e-8a4d-4c1e-9b7a-2d3e4f5a6b7c",
};

describe("bookSeriesInput", () => {
  it("accepts a block of 1 to 8 cleans", () => {
    for (const blockSize of [1, 4, 8]) expect(bookSeriesInput.safeParse({ ...valid, blockSize }).success).toBe(true);
  });

  it("refuses a block of 0, 9 or a fraction", () => {
    for (const blockSize of [0, 9, 2.5]) expect(bookSeriesInput.safeParse({ ...valid, blockSize }).success).toBe(false);
  });

  it("has no price field: anything extra is refused", () => {
    expect(bookSeriesInput.safeParse({ ...valid, pricePerHourPence: 1 }).success).toBe(false);
  });

  it("refuses odd lengths, bad days and back-to-front windows", () => {
    expect(bookSeriesInput.safeParse({ ...valid, durationMinutes: 135 }).success).toBe(false);
    expect(bookSeriesInput.safeParse({ ...valid, preferredDay: 0 }).success).toBe(false);
    expect(bookSeriesInput.safeParse({ ...valid, windowStart: "14:00", windowEnd: "10:00" }).success).toBe(false);
    expect(bookSeriesInput.safeParse({ ...valid, windowStart: "10:00", windowEnd: "11:30", durationMinutes: 120 }).success).toBe(false);
    expect(bookSeriesInput.safeParse({ ...valid, windowStart: "10:00", windowEnd: "12:00", durationMinutes: 120 }).success).toBe(true);
  });

  it("maps to the database's argument names", () => {
    const args = bookSeriesArgs(bookSeriesInput.parse(valid));
    expect(args).toEqual({
      p_property: valid.propertyId, p_frequency: "fortnightly", p_preferred_day: 3, p_window_start: "10:00",
      p_window_end: "14:00", p_duration_minutes: 120, p_starts_on: "2026-11-20", p_block_size: 4, p_request_id: valid.requestId,
    });
  });
});

describe("pingErrorMessage", () => {
  it("words Ping's own codes and never shows raw database text", () => {
    expect(pingErrorMessage({ code: "PC025" })).toBe("A booking is 1 to 8 cleans.");
    expect(pingErrorMessage({ code: "PC013" })).toMatch(/couldn.t do/);
    expect(pingErrorMessage({ code: "23505" })).toBe("Something went wrong. Please try again.");
    expect(pingErrorMessage(null)).toBe("Something went wrong. Please try again.");
    expect(isPingError({ code: "PC010" })).toBe(true);
    expect(isPingError({ code: "42501" })).toBe(false);
  });
});
