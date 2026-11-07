import { describe, expect, it } from "vitest";
import { directionsUrl } from "./directions";

describe("directions", () => {
  it("uses the address when there's no pin", () => {
    expect(directionsUrl({ address_line1: "12 Test Street", town: "Workington", postcode: "CA14 9ZZ", latitude: null, longitude: null })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=12%20Test%20Street%2C%20Workington%20CA14%209ZZ",
    );
  });

  it("prefers the pin, which is exact even for a farm or a new build", () => {
    expect(directionsUrl({ address_line1: "x", town: "y", postcode: "CA14 9ZZ", latitude: 54.6425, longitude: -3.5489 })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=54.6425%2C-3.5489",
    );
  });

  it("can't be bent into another link by what's in the address", () => {
    const url = new URL(directionsUrl({ address_line1: "1 A&B Road?x=1#y", town: "Town", postcode: "CA1 1AA", latitude: null, longitude: null }));
    expect(url.host).toBe("www.google.com");
    expect([...url.searchParams.keys()]).toEqual(["api", "destination"]);
    expect(url.searchParams.get("destination")).toBe("1 A&B Road?x=1#y, Town CA1 1AA");
  });
});
