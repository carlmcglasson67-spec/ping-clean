import { describe, expect, it } from "vitest";
import { daysAgo, formatDay, formatStamp, formatTime, formatWindow, monthStartInLondon, relativeDay, todayInLondon, weekdayName, withinLast } from "./dates";

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

  it("counts back in days, and knows what happened just now", () => {
    const now = new Date("2026-11-21T14:00:00Z");
    expect(daysAgo(30, now)).toBe("2026-10-22T14:00:00.000Z");
    expect(daysAgo(0, now)).toBe(now.toISOString());
    const tenMinutes = 10 * 60 * 1000;
    expect(withinLast("2026-11-21T13:55:00Z", tenMinutes, now)).toBe(true);
    expect(withinLast("2026-11-21T13:50:00Z", tenMinutes, now)).toBe(false); // exactly ten minutes old
    expect(withinLast("2026-11-21T13:00:00Z", tenMinutes, now)).toBe(false);
    expect(withinLast("2026-11-21T14:00:30Z", tenMinutes, now)).toBe(true); // clocks a few seconds apart
    expect(withinLast("2026-11-21T15:00:00Z", tenMinutes, now)).toBe(false); // the future isn't "just now"
  });
});
