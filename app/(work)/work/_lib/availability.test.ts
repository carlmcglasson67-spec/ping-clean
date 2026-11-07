import { describe, expect, it } from "vitest";
import { allowedAreas, availabilitySchema, slotsByDay, TIMES } from "./availability";

describe("working days", () => {
  it("offers half-hour times from 6am to 9pm", () => {
    expect(TIMES[0]).toBe("06:00");
    expect(TIMES[1]).toBe("06:30");
    expect(TIMES.at(-1)).toBe("21:00");
    expect(TIMES).toHaveLength(31);
  });

  it("accepts the shape the database checks, and nothing else", () => {
    expect(availabilitySchema.safeParse([{ day: 1, from: "08:30", to: "15:00" }]).success).toBe(true);
    expect(availabilitySchema.safeParse([]).success).toBe(true);
    for (const bad of [
      [{ day: 8, from: "09:00", to: "12:00" }],
      [{ day: 1.5, from: "09:00", to: "12:00" }],
      [{ day: 1, from: "12:00", to: "09:00" }],
      [{ day: 1, from: "9:00", to: "12:00" }],
      [{ day: 1, from: "09:00", to: "12:00" }, { day: 1, from: "13:00", to: "15:00" }],
    ]) {
      expect(availabilitySchema.safeParse(bad).success).toBe(false);
    }
  });

  it("reads stored slots by day, ignoring anything malformed", () => {
    const m = slotsByDay([{ day: 3, from: "08:30", to: "15:00" }, { day: 3, from: "16:00", to: "18:00" }, { day: "x" }]);
    expect([...m.keys()]).toEqual([3]);
    expect(m.get(3)).toEqual({ day: 3, from: "08:30", to: "15:00" });
    expect(slotsByDay(null).size).toBe(0);
  });

  it("lets a cleaner choose launch districts and keeps any they already cover", () => {
    expect(allowedAreas(["CA28", "CA14", "CA2"], ["CA13", "CA14", "bad"])).toEqual(["CA2", "CA13", "CA14", "CA28"]);
  });
});
