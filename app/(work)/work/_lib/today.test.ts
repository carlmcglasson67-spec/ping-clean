import { describe, expect, it } from "vitest";
import { cleansToDo, todayHeadline } from "./today";

describe("cleansToDo", () => {
  it("leaves out cleans cancelled when a block ended, keeps everything else", () => {
    const visits = [
      { id: "a", status: "scheduled" as const, cleaner_earnings_pence: 4000 },
      { id: "b", status: "cancelled" as const, cleaner_earnings_pence: 4000 },
      { id: "c", status: "in_progress" as const, cleaner_earnings_pence: 4000 },
      { id: "d", status: "completed" as const, cleaner_earnings_pence: 4000 },
    ];
    expect(cleansToDo(visits).map((v) => v.id)).toEqual(["a", "c", "d"]);
  });

  it("a day whose only clean was cancelled is a free day, not 'One clean today'", () => {
    const left = cleansToDo([{ id: "b", status: "cancelled" as const }]);
    expect(left).toEqual([]);
    expect(todayHeadline(left.length)).toBe("Nothing booked today.");
  });
});

describe("todayHeadline", () => {
  it("counts in words", () => {
    expect(todayHeadline(1)).toBe("One clean today.");
    expect(todayHeadline(3)).toBe("3 cleans today.");
  });
});
