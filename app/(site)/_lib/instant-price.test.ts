import { describe, expect, it } from "vitest";
import fixture from "@/tests/fixtures/split-cases.json";
import { parsePostcode } from "./postcode";
import { clampMinutes, quotePence } from "./quote";
import { parsePricing } from "./pricing-shape";

describe("parsePostcode", () => {
  it("normalises full postcodes to the stored form", () => {
    expect(parsePostcode("ca14 3xx")).toEqual({ kind: "full", postcode: "CA14 3XX", district: "CA14" });
    expect(parsePostcode("  CA284AB ")).toEqual({ kind: "full", postcode: "CA28 4AB", district: "CA28" });
    expect(parsePostcode("ca2 7nq")).toEqual({ kind: "full", postcode: "CA2 7NQ", district: "CA2" });
    expect(parsePostcode("EC1A 1BB")).toEqual({ kind: "full", postcode: "EC1A 1BB", district: "EC1A" });
  });

  it("accepts a district on its own", () => {
    expect(parsePostcode("ca14")).toEqual({ kind: "district", district: "CA14" });
  });

  it("rejects things that aren't postcodes", () => {
    expect(parsePostcode("workington")).toEqual({ kind: "invalid" });
    expect(parsePostcode("CA14 3X")).toEqual({ kind: "invalid" });
    expect(parsePostcode("12345")).toEqual({ kind: "invalid" });
    expect(parsePostcode("   ")).toEqual({ kind: "empty" });
  });
});

describe("quotePence", () => {
  it("matches the database price for every shared fixture case", () => {
    for (const c of fixture.cases) expect(quotePence(c.pph, c.minutes)).toBe(c.price);
  });

  it("returns whole pence and refuses fractions", () => {
    expect(Number.isSafeInteger(quotePence(1999, 150))).toBe(true);
    expect(() => quotePence(19.99, 60)).toThrow(RangeError);
  });
});

describe("clampMinutes", () => {
  it("keeps bookings between the settings minimum and the schema maximum, in half hours", () => {
    expect(clampMinutes(30, 120)).toBe(120);
    expect(clampMinutes(150, 120)).toBe(150);
    expect(clampMinutes(155, 120)).toBe(150);
    expect(clampMinutes(900, 120)).toBe(600);
  });
});

describe("parsePricing", () => {
  const ready = { price_per_hour_pence: 2000, min_booking_minutes: 120, launch_districts: ["CA14"], ready: true };

  it("opens only when settings are complete", () => {
    expect(parsePricing([ready])).toEqual({ status: "open", pricePerHourPence: 2000, minBookingMinutes: 120, launchDistricts: ["CA14"] });
  });

  it("says 'soon' while prices are unset, never inventing a number", () => {
    expect(parsePricing([{ price_per_hour_pence: null, min_booking_minutes: null, launch_districts: [], ready: false }])).toEqual({ status: "soon" });
    expect(parsePricing([{ ...ready, ready: false }])).toEqual({ status: "soon" });
    expect(parsePricing([{ ...ready, price_per_hour_pence: null }])).toEqual({ status: "soon" });
    expect(parsePricing([{ ...ready, launch_districts: [] }])).toEqual({ status: "soon" });
  });

  it("treats a malformed response as unavailable", () => {
    expect(parsePricing([])).toEqual({ status: "unavailable" });
    expect(parsePricing([{ ...ready, price_per_hour_pence: 20.5 }])).toEqual({ status: "unavailable" });
    expect(parsePricing(null)).toEqual({ status: "unavailable" });
  });
});
