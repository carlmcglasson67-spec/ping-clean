// Payments PR 3: the Stripe webhook event log functions. Service role only.
import { afterAll, describe, expect, it } from "vitest";
import { as, DENIED, pool, type Query } from "./helpers";

afterAll(() => pool.end());

const asServer = <T>(fn: (q: Query) => Promise<T>) => as("superuser", async (q) => {
  await q.rows(`set local role service_role`);
  return fn(q);
});
const begin = async (q: Query, id: string) =>
  (await q.rows<{ r: string }>(`select public.stripe_begin_event($1, 'payment_intent.succeeded', null) as r`, [id]))[0]!.r;

describe("stripe event log", () => {
  it("says 'process' the first time, 'done' once handled, and 'process' again after a failure", async () => {
    const r = await asServer(async (q) => {
      const first = await begin(q, "evt_testLog00001");
      const whileRunning = await begin(q, "evt_testLog00001"); // not finished yet: process (handlers are idempotent)
      await q.rows(`select public.stripe_finish_event('evt_testLog00001', 'database busy')`);
      const afterFailure = await begin(q, "evt_testLog00001");
      await q.rows(`select public.stripe_finish_event('evt_testLog00001', null)`);
      const handled = await begin(q, "evt_testLog00001");
      await q.rows(`reset role`);
      const [row] = await q.rows(`select error, processed_at is not null as done from private.stripe_events where event_id = 'evt_testLog00001'`);
      return { first, whileRunning, afterFailure, handled, row, rows: await q.count(`private.stripe_events where event_id = 'evt_testLog00001'`) };
    });
    expect(r).toEqual({ first: "process", whileRunning: "process", afterFailure: "process", handled: "done",
      row: { error: null, done: true }, rows: 1 });
  });

  it("can only be used by the server", async () => {
    for (const who of ["anon", "anna", "tara", "admin"] as const) {
      expect({ who, code: await as(who, (q) => q.attempt(`select public.stripe_begin_event('evt_testLog00002', 'x', null)`)) })
        .toEqual({ who, code: DENIED });
      expect({ who, code: await as(who, (q) => q.attempt(`select public.stripe_finish_event('evt_testLog00002', null)`)) })
        .toEqual({ who, code: DENIED });
    }
  });

  it("keeps the event log's own checks (no junk ids)", async () => {
    expect(await asServer((q) => q.attempt(`select public.stripe_begin_event('not-an-event', 'x', null)`))).toBe("23514");
  });
});
