import { describe, expect, it } from "vitest";
import { bookSeriesInput } from "@/lib/booking";
import { blockTotalPence, cleanFields, cleanWindow, firstCleanDate, homeFields, isoWeekday, lastCleanDate } from "./checkout";

describe("cleanWindow", () => {
  it("runs from the start of the arrival window to the latest arrival plus the clean", () => {
    expect(cleanWindow("morning", 120)).toEqual({ start: "09:00", end: "12:00" });
    expect(cleanWindow("afternoon", 150)).toEqual({ start: "12:00", end: "16:30" });
  });

  it("always passes lib/booking's own window rule", () => {
    for (const arrival of ["early", "morning", "late-morning", "afternoon"] as const) {
      for (let mins = 60; mins <= 600; mins += 30) {
        const w = cleanWindow(arrival, mins);
        if (!w) continue;
        const ok = bookSeriesInput.safeParse({
          propertyId: "00000000-0000-4000-8000-000000000001",
          frequency: "weekly",
          preferredDay: 1,
          windowStart: w.start,
          windowEnd: w.end,
          durationMinutes: mins,
          startsOn: "2026-12-01",
          blockSize: 8,
          requestId: "00000000-0000-4000-8000-000000000002",
        });
        expect(ok.success, `${arrival} ${mins}`).toBe(true);
      }
    }
  });

  it("refuses a clean that would run past 8pm", () => {
    expect(cleanWindow("afternoon", 600)).toBeNull();
    expect(cleanWindow("early", 600)).toEqual({ start: "08:00", end: "19:00" });
  });
});

describe("block dates mirror the database", () => {
  it("knows the weekday", () => {
    expect(isoWeekday("2026-11-09")).toBe(1); // a Monday
    expect(isoWeekday("2026-11-15")).toBe(7);
  });

  it("first clean is the preferred day on or after the start", () => {
    expect(firstCleanDate("2026-11-09", 1)).toBe("2026-11-09");
    expect(firstCleanDate("2026-11-10", 1)).toBe("2026-11-16");
    expect(firstCleanDate("2026-11-09", 4)).toBe("2026-11-12");
  });

  it("last clean counts the block on its cadence", () => {
    expect(lastCleanDate("2026-11-09", 4, "weekly", 8)).toBe("2026-12-31");
    expect(lastCleanDate("2026-11-09", 4, "fortnightly", 8)).toBe("2027-02-18");
    expect(lastCleanDate("2026-11-09", 4, "weekly", 1)).toBe("2026-11-12");
  });
});

describe("blockTotalPence", () => {
  it("is the price per clean times the number of cleans", () => {
    expect(blockTotalPence(2000, 120, 8)).toBe(32000);
    expect(blockTotalPence(2150, 150, 3)).toBe(16125);
  });

  it("refuses a block outside 1 to 8", () => {
    expect(() => blockTotalPence(2000, 120, 0)).toThrow(RangeError);
    expect(() => blockTotalPence(2000, 120, 9)).toThrow(RangeError);
  });
});

describe("form fields", () => {
  const home = { postcode: "ca14 3xx", addressLine1: " 4 Sea View ", addressLine2: "", town: "Workington", bedrooms: "3", bathrooms: "1", pets: "", accessNotes: "", keyCode: "" };

  it("normalises a home and blanks become null", () => {
    expect(homeFields.parse(home)).toEqual({
      postcode: "CA14 3XX", addressLine1: "4 Sea View", addressLine2: null, town: "Workington",
      bedrooms: 3, bathrooms: 1, pets: null, accessNotes: null, keyCode: null,
    });
  });

  it("needs a full postcode for the address, not just the district", () => {
    expect(homeFields.safeParse({ ...home, postcode: "CA14" }).success).toBe(false);
  });

  it("refuses four-weekly, an unknown window and a block of 9", () => {
    const clean = { frequency: "weekly", preferredDay: "4", arrival: "morning", durationMinutes: "120", startsOn: "2026-12-01", blockSize: "8", requestId: "00000000-0000-4000-8000-000000000002" };
    expect(cleanFields.safeParse(clean).success).toBe(true);
    expect(cleanFields.safeParse({ ...clean, frequency: "four_weekly" }).success).toBe(false);
    expect(cleanFields.safeParse({ ...clean, arrival: "midnight" }).success).toBe(false);
    expect(cleanFields.safeParse({ ...clean, blockSize: "9" }).success).toBe(false);
  });

  it("has no price field to send", () => {
    expect(Object.keys(cleanFields.shape)).not.toContain("price");
  });
});
