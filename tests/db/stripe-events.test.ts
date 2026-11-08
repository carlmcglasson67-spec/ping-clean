// Payments PR 3: the Stripe webhook event log functions. Service role only.
import { afterAll, describe, expect, it } from "vitest";
import { as, DENIED, pool, type Query } from "./helpers";

afterAll(() => pool.end());

const asServer = <T>(fn: (q: Query) => Promise<T>) => as("superuser", async (q) => {
  await q.rows(`set local role service_role`);
  return fn(q);
});
type Begun = { outcome: string; lease: string | null };
const begin = async (q: Query, id: string) =>
  (await q.rows<Begun>(`select * from public.stripe_begin_event($1, 'payment_intent.succeeded', null)`, [id]))[0]!;
const finish = async (q: Query, id: string, lease: string | null, error: string | null) =>
  (await q.rows<{ ok: boolean }>(`select public.stripe_finish_event($1, $2, $3) as ok`, [id, lease, error]))[0]!.ok;
/** Pretend the current lease started `minutes` ago (the copy holding it died). */
const age = async (q: Query, id: string, minutes: number) => {
  await q.rows(`reset role`);
  await q.rows(`update private.stripe_events set started_at = clock_timestamp() - make_interval(mins => $2) where event_id = $1`, [id, minutes]);
  await q.rows(`set local role service_role`);
};

describe("stripe event log", () => {
  it("leases an event to one copy: 'process' with a token, 'busy' while it runs, again after a failure, 'duplicate' once handled", async () => {
    const r = await asServer(async (q) => {
      const first = await begin(q, "evt_testLog00001");
      const whileRunning = await begin(q, "evt_testLog00001"); // a concurrent copy: not done, not ours
      const failed = await finish(q, "evt_testLog00001", first.lease, "database busy"); // frees the lease at once
      const afterFailure = await begin(q, "evt_testLog00001");
      const done = await finish(q, "evt_testLog00001", afterFailure.lease, null);
      const handled = await begin(q, "evt_testLog00001");
      await q.rows(`reset role`);
      const [row] = await q.rows(`select error, processed_at is not null as done from private.stripe_events where event_id = 'evt_testLog00001'`);
      return { first: first.outcome, token: !!first.lease, whileRunning, failed, afterFailure: afterFailure.outcome,
        newToken: afterFailure.lease !== first.lease, done, handled, row };
    });
    expect(r).toEqual({ first: "process", token: true, whileRunning: { outcome: "busy", lease: null }, failed: true,
      afterFailure: "process", newToken: true, done: true, handled: { outcome: "duplicate", lease: null },
      row: { error: null, done: true } });
  });

  it("the reviewer's case: a stale copy's late failure can't clear the copy that took over", async () => {
    const id = "evt_testLog00003";
    const r = await asServer(async (q) => {
      const a = await begin(q, id);            // copy A starts, then stalls
      await age(q, id, 4);
      const early = await begin(q, id);        // within 5 minutes: still A's
      await age(q, id, 6);
      const b = await begin(q, id);            // A's lease ran out: copy B takes over
      const aFails = await finish(q, id, a.lease, "timed out"); // A reports failed, late
      const c = await begin(q, id);            // B's lease is intact: copy C waits
      const aSucceeds = await finish(q, id, a.lease, null);      // nor can A mark it done
      const bDone = await finish(q, id, b.lease, null);
      const after = await begin(q, id);
      return { early: early.outcome, b: b.outcome, differs: a.lease !== b.lease, aFails, c: c.outcome, aSucceeds, bDone, after: after.outcome };
    });
    expect(r).toEqual({ early: "busy", b: "process", differs: true, aFails: false, c: "busy", aSucceeds: false, bDone: true, after: "duplicate" });
  });

  it("can only be used by the server", async () => {
    for (const who of ["anon", "anna", "tara", "admin"] as const) {
      expect({ who, code: await as(who, (q) => q.attempt(`select public.stripe_begin_event('evt_testLog00002', 'x', null)`)) })
        .toEqual({ who, code: DENIED });
      expect({ who, code: await as(who, (q) => q.attempt(`select public.stripe_finish_event('evt_testLog00002', gen_random_uuid(), null)`)) })
        .toEqual({ who, code: DENIED });
    }
  });

  it("keeps the event log's own checks (no junk ids)", async () => {
    expect(await asServer((q) => q.attempt(`select public.stripe_begin_event('not-an-event', 'x', null)`))).toBe("23514");
  });
});
