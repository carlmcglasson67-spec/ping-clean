/** PostgREST returns at most this many rows per request (the project default). */
export const ROW_CAP = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { code?: string | null } | null }>;

/**
 * Every row a query matches, read in keyset pages (`key > last seen`, ordered by key), so
 * nothing is lost to the row cap however large the table grows. The caller's query must
 * order by `key` ascending, limit to `cap`, and filter `key > after` when `after` is given.
 * Re-sort the result afterwards if the page needs another order.
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

/**
 * The rows for a long list of ids, asked for a slice at a time: one `in (…)` with
 * thousands of ids is too long a URL, and its answer would be cut at the row cap.
 */
export async function readByIds<T>(ids: readonly string[], fetch: (slice: string[]) => Page<T>, size = 200) {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) {
    const { data, error } = await fetch(ids.slice(i, i + size));
    if (error) return { data: null, error };
    out.push(...(data ?? []));
  }
  return { data: out, error: null };
}
