/**
 * The current document of each kind: the most recently sent. Older copies stay in the
 * table (the audit trail), but a cleaner only ever deals with the newest one.
 */
export function latestByKind<T extends { kind: K; created_at: string }, K extends string>(docs: readonly T[]): Map<K, T> {
  const out = new Map<K, T>();
  for (const d of docs) {
    const seen = out.get(d.kind);
    if (!seen || d.created_at > seen.created_at) out.set(d.kind, d);
  }
  return out;
}
