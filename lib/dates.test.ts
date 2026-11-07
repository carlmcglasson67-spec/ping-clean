import { describe, expect, it } from "vitest";
import { formatDay, formatStamp, formatTime, formatWindow, monthStartInLondon, relativeDay, todayInLondon, weekdayName } from "./dates";

// In summer (BST) London is an hour ahead of UTC, so late at night the London date
// is already tomorrow while a UTC server still thinks it's today.
const lateSummerNight = new Date("2026-07-14T23:30:00Z"); // 00:30 on 15 July in London
const novemberMorning = new Date("2026-11-06T09:00:00Z");

describe("dates", () => {
  it("uses London's date, not the server's", () => {
    expect(todayInLondon(lateSummerNight)).toBe("2026-07-15");
    expect(todayInLondon(novemberMorning)).toBe("2026-11-06");
    expect(monthStartInLondon(novemberMorning)).toBe("2026-11-01");
  });

  it("formats days the way people read them", () => {
    expect(formatDay("2026-11-09", novemberMorning)).toBe("Monday 9 November");
    expect(formatDay("2027-01-04", novemberMorning)).toBe("Monday 4 January 2027");
    expect(relativeDay("2026-11-06", novemberMorning)).toBe("Today");
    expect(relativeDay("2026-11-07", novemberMorning)).toBe("Tomorrow");
    expect(relativeDay("2026-11-11", novemberMorning)).toBe("Wednesday 11 November");
  });

  it("formats times in UK style", () => {
    expect(formatTime("09:00:00")).toBe("9am");
    expect(formatTime("13:30")).toBe("1.30pm");
    expect(formatTime("12:00")).toBe("12pm");
    expect(formatTime("00:15")).toBe("12.15am");
    expect(formatWindow("09:00:00", "12:00:00")).toBe("9am–12pm");
    expect(formatStamp("2026-11-06T14:03:00Z")).toBe("6 Nov, 2.03pm");
  });

  it("names ISO weekdays", () => {
    expect(weekdayName(1)).toBe("Monday");
    expect(weekdayName(7)).toBe("Sunday");
    expect(() => weekdayName(0)).toThrow(RangeError);
  });
});
