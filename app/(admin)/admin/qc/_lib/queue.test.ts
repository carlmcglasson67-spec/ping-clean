import { describe, expect, it } from "vitest";
import { orderQueue, pageOf, readAll } from "./queue";

describe("QC queue", () => {
  it("reads past the row cap in keyset pages, losing nothing", async () => {
    const all = Array.from({ length: 2503 }, (_, i) => ({ id: String(i).padStart(5, "0") }));
    const calls: (string | null)[] = [];
    const r = await readAll(async (after) => {
      calls.push(after);
      return { data: all.filter((x) => after === null || x.id > after).slice(0, 1000), error: null };
    }, "id");
    expect(r.data).toHaveLength(2503);
    expect(calls).toEqual([null, "00999", "01999"]);
  });

  it("stops on an error", async () => {
    const r = await readAll<{ id: string }>(async () => ({ data: null, error: { code: "XX" } }), "id");
    expect(r).toEqual({ data: null, error: { code: "XX" } });
  });

  it("flagged cleans first, then newest; scored ones left out", () => {
    const q = orderQueue(
      [
        { id: "a", completed_at: "2026-11-01T10:00:00Z", couldnt_do_count: 0 },
        { id: "b", completed_at: "2026-11-03T10:00:00Z", couldnt_do_count: 0 },
        { id: "c", completed_at: "2026-10-01T10:00:00Z", couldnt_do_count: 2 },
        { id: "d", completed_at: "2026-11-04T10:00:00Z", couldnt_do_count: 0 },
      ],
      new Set(["d"]),
    );
    expect(q.map((v) => v.id)).toEqual(["c", "b", "a"]);
  });

  it("pages, clamping a page that doesn't exist", () => {
    const rows = Array.from({ length: 30 }, (_, i) => i);
    expect(pageOf(rows, 1, 12)).toMatchObject({ page: 1, pages: 3, rows: rows.slice(0, 12) });
    expect(pageOf(rows, 3, 12).rows).toEqual([24, 25, 26, 27, 28, 29]);
    expect(pageOf(rows, 9, 12).page).toBe(3);
    expect(pageOf(rows, Number.NaN, 12).page).toBe(1);
    expect(pageOf([], 1, 12)).toMatchObject({ page: 1, pages: 1, rows: [] });
  });
});
