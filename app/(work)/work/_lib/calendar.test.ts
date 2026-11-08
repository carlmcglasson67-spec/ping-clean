import { describe, expect, it } from "vitest";
import { blockPositions, isYmd, minutesOf, startOfWeek, step, viewDays, viewTitle } from "./calendar";

// 2026-11-07 is a Saturday.
describe("calendar", () => {
  it("starts weeks on Monday", () => {
    expect(startOfWeek("2026-11-07")).toBe("2026-11-02");
    expect(startOfWeek("2026-11-02")).toBe("2026-11-02");
    expect(startOfWeek("2026-11-08")).toBe("2026-11-02"); // Sunday belongs to the week before
  });

  it("shows a week, or whole weeks covering a month", () => {
    expect(viewDays("week", "2026-11-07")).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
    const nov = viewDays("month", "2026-11-18");
    expect(nov[0]).toBe("2026-10-26");
    expect(nov.at(-1)).toBe("2026-12-06");
    expect(nov.length % 7).toBe(0);
    expect(viewDays("month", "2027-02-10")).toHaveLength(28); // Feb 2027 starts on a Monday
  });

  it("steps by a week or a month, across year ends", () => {
    expect(step("week", "2026-11-07", 1)).toBe("2026-11-09");
    expect(step("week", "2026-11-07", -1)).toBe("2026-10-26");
    expect(step("month", "2026-12-15", 1)).toBe("2027-01-01");
    expect(step("month", "2026-01-31", -1)).toBe("2025-12-01");
  });

  it("titles views the British way", () => {
    expect(viewTitle("month", "2026-11-07")).toBe("November 2026");
    expect(viewTitle("week", "2026-11-11")).toBe("9–15 November 2026");
    expect(viewTitle("week", "2026-12-02")).toBe("30 Nov – 6 Dec 2026");
    expect(viewTitle("week", "2026-12-31")).toBe("28 Dec 2026 – 3 Jan 2027");
  });

  it("only accepts real dates from the address bar", () => {
    expect(isYmd("2026-11-07")).toBe(true);
    for (const bad of ["2026-02-31", "2026-13-01", "07/11/2026", "", null, "2026-11-07T00:00"]) expect(isYmd(bad)).toBe(false);
  });

  it("numbers each clean within its block by date", () => {
    const pos = blockPositions([
      { id: "c", series_id: "s1", scheduled_date: "2026-11-21" },
      { id: "a", series_id: "s1", scheduled_date: "2026-11-07" },
      { id: "b", series_id: "s1", scheduled_date: "2026-11-14" },
      { id: "x", series_id: "s2", scheduled_date: "2026-11-18" },
    ]);
    expect([pos.get("a"), pos.get("b"), pos.get("c"), pos.get("x")]).toEqual([1, 2, 3, 1]);
  });

  it("reads times", () => {
    expect(minutesOf("09:30:00")).toBe(570);
  });
});
