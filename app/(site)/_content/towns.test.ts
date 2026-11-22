import { describe, expect, it } from "vitest";
import { DISTRICT_TOWN } from "../../(work)/work/_lib/availability";
import { AREA_GROUPS, townCount } from "./nav";
import { REGIONS, TOWNS, townBySlug } from "./towns";

describe("area content", () => {
  it("lists Carlisle first, then West Cumbria", () => {
    expect(REGIONS.map((r) => r.id)).toEqual(["carlisle", "west"]);
    expect(AREA_GROUPS[0]!.links[0]!.label).toBe("Carlisle");
  });

  it("covers every Carlisle district, CA1 to CA8, with a page", () => {
    const carlisle = TOWNS.filter((t) => t.region === "carlisle").flatMap((t) => t.districts);
    expect([...carlisle].sort()).toEqual(["CA1", "CA2", "CA3", "CA4", "CA5", "CA6", "CA7", "CA8"]);
  });

  it("names every district a town page uses, so cleaners never pick from bare codes", () => {
    for (const t of TOWNS) for (const d of t.districts) expect(DISTRICT_TOWN[d], `${t.name} ${d}`).toBeTruthy();
  });

  it("has unique slugs and every nearby link resolves to a town in the same region", () => {
    expect(new Set(TOWNS.map((t) => t.slug)).size).toBe(TOWNS.length);
    for (const t of TOWNS) {
      for (const n of t.near) {
        const near = townBySlug(n);
        expect(near, `${t.slug} → ${n}`).toBeDefined();
        expect(near!.region, `${t.slug} → ${n}`).toBe(t.region);
      }
    }
  });

  it("counts towns in words for the copy", () => {
    expect(townCount()).toBe("Sixteen towns and villages");
  });
});
