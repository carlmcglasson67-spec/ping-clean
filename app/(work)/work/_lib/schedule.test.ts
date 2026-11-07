import { describe, expect, it } from "vitest";
import { firstVisitDate, formatShortDay } from "./schedule";

// 2026-11-07 is a Saturday. ISO weekdays: Mon = 1 … Sun = 7.
describe("first visit date", () => {
  it("is the first preferred weekday on or after the start", () => {
    expect(firstVisitDate("2026-11-14", 3, "fortnightly", "2026-11-07")).toBe("2026-11-18"); // Sat start → Wed
    expect(firstVisitDate("2026-11-18", 3, "weekly", "2026-11-07")).toBe("2026-11-18"); // starts on a Wednesday
  });

  it("is never today or in the past, stepping by the frequency like the engine", () => {
    expect(firstVisitDate("2026-10-24", 6, "weekly", "2026-11-07")).toBe("2026-11-14"); // today is a visit day: next week
    expect(firstVisitDate("2026-10-24", 6, "fortnightly", "2026-11-07")).toBe("2026-11-21");
    expect(firstVisitDate("2026-10-01", 4, "four_weekly", "2026-11-07")).toBe("2026-11-26");
  });

  it("writes the block's last clean the short British way", () => {
    expect(formatShortDay("2026-12-23")).toBe("23 Dec");
    expect(formatShortDay("2027-01-04")).toBe("4 Jan");
  });

  it("crosses month and year ends cleanly", () => {
    expect(firstVisitDate("2026-12-29", 1, "weekly", "2026-12-28")).toBe("2027-01-04");
  });
});
