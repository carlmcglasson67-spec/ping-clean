import { describe, expect, it } from "vitest";
import fixture from "@/tests/fixtures/split-cases.json";
import { formatDuration, formatPence, formatPenceShort, splitVisitPrice, type CommissionType } from ".";

describe("splitVisitPrice matches the database exactly", () => {
  it.each(fixture.cases)("$pph p/h × $minutes min, $type $value → $price = $earnings + $fee", (c) => {
    const split = splitVisitPrice({
      pricePerHourPence: c.pph,
      durationMinutes: c.minutes,
      commissionType: c.type as CommissionType,
      commissionValue: c.value,
    });
    expect(split).toEqual({ pricePence: c.price, pingFeePence: c.fee, cleanerEarningsPence: c.earnings });
    expect(split.cleanerEarningsPence + split.pingFeePence).toBe(split.pricePence);
  });

  it("refuses fractions of a penny instead of rounding them silently", () => {
    expect(() => splitVisitPrice({ pricePerHourPence: 19.99, durationMinutes: 60, commissionType: "percent", commissionValue: 2500 })).toThrow(RangeError);
  });

  it("refuses a commission over 100%", () => {
    expect(() => splitVisitPrice({ pricePerHourPence: 2000, durationMinutes: 60, commissionType: "percent", commissionValue: 10_001 })).toThrow(RangeError);
  });

  it("refuses a zero-length visit", () => {
    expect(() => splitVisitPrice({ pricePerHourPence: 2000, durationMinutes: 0, commissionType: "percent", commissionValue: 2500 })).toThrow(RangeError);
  });
});

describe("formatting", () => {
  it("formats pence as pounds", () => {
    expect(formatPence(5000)).toBe("£50.00");
    expect(formatPence(2775)).toBe("£27.75");
    expect(formatPence(5)).toBe("£0.05");
    expect(formatPenceShort(5000)).toBe("£50");
    expect(formatPenceShort(5050)).toBe("£50.50");
  });

  it("refuses non-integer pence", () => {
    expect(() => formatPence(10.5)).toThrow(RangeError);
  });

  it("formats durations the way people say them", () => {
    expect(formatDuration(60)).toBe("1 hour");
    expect(formatDuration(90)).toBe("1½ hours");
    expect(formatDuration(120)).toBe("2 hours");
    expect(formatDuration(150)).toBe("2½ hours");
  });
});
