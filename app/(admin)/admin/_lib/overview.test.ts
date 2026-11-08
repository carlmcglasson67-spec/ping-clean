import { describe, expect, it } from "vitest";
import { cleansDoneToday } from "./overview";

describe("cleansDoneToday", () => {
  it("leaves cancelled cleans out of the count of cleans due", () => {
    expect(
      cleansDoneToday([{ status: "completed" }, { status: "scheduled" }, { status: "cancelled" }, { status: "cancelled" }]),
    ).toEqual({ done: 1, due: 2 });
  });

  it("a day with only cancelled cleans reads 0/0, not 0/1", () => {
    expect(cleansDoneToday([{ status: "cancelled" }])).toEqual({ done: 0, due: 0 });
  });
});
