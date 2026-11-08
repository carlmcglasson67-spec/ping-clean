// readAll moved to the admin lib so every section pages the same way.
export { readAll, ROW_CAP } from "../../_lib/read-all";

export type Finished = { id: string; completed_at: string | null; couldnt_do_count: number };

/** Unscored cleans in the order the team works them: flagged ("couldn't do") first, then newest. */
export function orderQueue(finished: readonly Finished[], scored: ReadonlySet<string>): Finished[] {
  return finished
    .filter((v) => !scored.has(v.id))
    .sort((a, b) =>
      Number(b.couldnt_do_count > 0) - Number(a.couldnt_do_count > 0)
      || (b.completed_at ?? "").localeCompare(a.completed_at ?? "")
      || a.id.localeCompare(b.id));
}

/** One page of the queue (1-based), with the page number clamped to what exists. */
export function pageOf<T>(rows: readonly T[], requested: number, size: number) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(Math.max(1, Number.isInteger(requested) ? requested : 1), pages);
  return { page, pages, rows: rows.slice((page - 1) * size, page * size) };
}
