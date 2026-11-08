/** PostgREST returns at most this many rows per request (the project default). */
export const ROW_CAP = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { code?: string | null } | null }>;

/**
 * Every row a query matches, read in keyset pages (`key > last seen`, ordered by key), so
 * nothing is lost to the row cap however large the table grows. The caller's query must
 * order by `key` ascending and filter `key > after` when `after` is given.
 */
export async function readAll<T>(page: (after: string | null) => Page<T>, key: keyof T & string, cap = ROW_CAP) {
  const out: T[] = [];
  let after: string | null = null;
  for (;;) {
    const { data, error } = await page(after);
    if (error) return { data: null, error };
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < cap) return { data: out, error: null };
    after = String(rows[rows.length - 1]![key]);
  }
}

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
