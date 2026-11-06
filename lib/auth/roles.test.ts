import { describe, expect, it } from "vitest";
import { areaForPath, canEnter, homeFor, postLoginPath } from "./roles";

describe("roles", () => {
  it("sends each role to its own app", () => {
    expect(homeFor("customer")).toBe("/account");
    expect(homeFor("cleaner")).toBe("/work");
    expect(homeFor("admin")).toBe("/admin");
  });

  it("works out which area a path belongs to", () => {
    expect(areaForPath("/account")).toBe("customer");
    expect(areaForPath("/account/visits/123")).toBe("customer");
    expect(areaForPath("/work/today")).toBe("cleaner");
    expect(areaForPath("/admin")).toBe("admin");
    expect(areaForPath("/")).toBeNull();
    expect(areaForPath("/workington")).toBeNull(); // an area page, not the cleaner app
    expect(areaForPath("/administration")).toBeNull();
  });

  it("keeps each role inside its own app", () => {
    expect(canEnter("customer", "customer")).toBe(true);
    expect(canEnter("customer", "cleaner")).toBe(false);
    expect(canEnter("cleaner", "admin")).toBe(false);
    expect(canEnter("admin", "customer")).toBe(false);
  });

  it("only follows ?next= inside the user's own area", () => {
    expect(postLoginPath("customer", "/account/visits")).toBe("/account/visits");
    expect(postLoginPath("customer", "/admin")).toBe("/account");
    expect(postLoginPath("cleaner", "https://evil.example")).toBe("/work");
    expect(postLoginPath("cleaner", "//evil.example/work")).toBe("/work");
    expect(postLoginPath("cleaner", "/\\evil.example")).toBe("/work");
    expect(postLoginPath("admin", null)).toBe("/admin");
  });
});
