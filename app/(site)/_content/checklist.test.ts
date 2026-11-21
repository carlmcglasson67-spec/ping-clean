import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STANDARD_CLEAN, STANDARD_CLEAN_COUNT } from "./checklist";

// The site tells customers what a regular clean covers; the app gives the cleaner a list to
// tick. They are written in two places (customer wording here, cleaner wording in the
// migration that installs the default template), so this keeps them from drifting apart.
type Item = { key: string; room: string; label: string };

function templateItems(): Item[] {
  const sql = readFileSync("supabase/migrations/20261121090100_standard_checklist.sql", "utf8");
  const json = sql.slice(sql.indexOf("'[") + 1, sql.indexOf("]'") + 1);
  return JSON.parse(json) as Item[];
}

describe("the standard clean: the site and the cleaner's checklist", () => {
  const items = templateItems();

  it("the cleaner ticks as many items as the site promises", () => {
    expect(items).toHaveLength(STANDARD_CLEAN_COUNT);
    expect(STANDARD_CLEAN_COUNT).toBe(11);
  });

  it("every item has a key, a room and a label, and no key is used twice", () => {
    for (const i of items) {
      expect(i.key).toMatch(/^[a-z]+\.[a-z]+$/);
      expect(i.room.length).toBeGreaterThan(2);
      expect(i.label.length).toBeGreaterThan(5);
    }
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });

  it("the same jobs, in the same order, on both", () => {
    // Customer and cleaner wording differ slightly ("if you leave it out" / "if left out"),
    // so compare the first two words of each line: enough to catch a job added, dropped or moved.
    const start = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").split(" ").slice(0, 2).join(" ");
    expect(items.map((i) => start(i.label))).toEqual(STANDARD_CLEAN.flatMap((r) => r.items).map(start));
  });
});
