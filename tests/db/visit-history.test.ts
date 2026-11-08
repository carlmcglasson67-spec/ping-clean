// Issue #12 note 1 (payments plan PR 1): visits that money depends on are never deleted.
import { afterAll, describe, expect, it } from "vitest";
import { as, IDS, pool, setupThen, U, type Query } from "./helpers";

afterAll(() => pool.end());

const END = `select public.admin_end_block($1, $2)`;

/** A payment row on a visit, as the charge job will write one. */
const pay = (su: Query, visit: string, key: string) =>
  su.rows(`insert into public.payments (visit_id, customer_id, amount_pence, application_fee_pence, idempotency_key)
           values ($1, $2, 5000, 1000, $3)`, [visit, U.anna, key]);
const payout = (su: Query, visit: string, key: string) =>
  su.rows(`insert into public.payouts (visit_id, cleaner_id, amount_pence, available_after, idempotency_key)
           values ($1, $2, 4000, now() + interval '3 days', $3)`, [visit, U.tara, key]);

describe("ending a block keeps its visits", () => {
  it("cancels the cleans still to come, stamped with when and by whom, instead of deleting them", async () => {
    const r = await setupThen(async () => {}, U.admin, async (q) => {
      const before = await q.count(`public.visits where series_id = '${IDS.annaSeries}'`);
      await q.rows(END, [IDS.annaSeries, "Customer moving house"]);
      await q.rows(`reset role`);
      const rows = await q.rows<{ id: string; status: string; by: string | null; stamped: boolean }>(
        `select id, status::text, cancelled_by::text as by, cancelled_at is not null as stamped
           from public.visits where series_id = $1 order by scheduled_date`, [IDS.annaSeries]);
      return { before, rows };
    });
    expect(r.rows).toHaveLength(r.before); // nothing deleted
    expect(r.rows).toEqual([
      { id: IDS.visitDone, status: "completed", by: null, stamped: false },
      { id: IDS.visitToday, status: "cancelled", by: U.admin, stamped: true },
      { id: IDS.visitNextWeek, status: "cancelled", by: U.admin, stamped: true },
    ]);
  });

  it("works when the engine closes a block too (no admin: cancelled_by stays empty)", async () => {
    const rows = await as("superuser", async (q) => {
      await q.rows(`select private.close_block($1, null, 'No cleans left to give')`, [IDS.annaSeries]);
      return q.rows<{ status: string; by: string | null }>(
        `select status::text, cancelled_by::text as by from public.visits where id = $1`, [IDS.visitNextWeek]);
    });
    expect(rows).toEqual([{ status: "cancelled", by: null }]);
  });

  it("ends a block even when its future cleans have money rows (the case issue #12 found)", async () => {
    const r = await setupThen(async (su) => {
      await pay(su, IDS.visitNextWeek, "test:hold:next-week");
    }, U.admin, async (q) => ({
      end: await q.attempt(END, [IDS.annaSeries, "Customer moving house"]),
      kept: await q.count(`public.payments where visit_id = '${IDS.visitNextWeek}'`),
    }));
    expect(r).toEqual({ end: "ok", kept: 1 });
  });
});

describe("a visit with money rows can't be deleted", () => {
  it("refuses with PC016 for a payment or a payout, even for the database owner", async () => {
    for (const [label, add] of [["payment", pay], ["payout", payout]] as const) {
      const code = await setupThen(async (su) => { await add(su, IDS.visitToday, `test:${label}`); }, null,
        (su) => su.attempt(`delete from public.visits where id = $1`, [IDS.visitToday]));
      expect({ label, code }).toEqual({ label, code: "PC016" });
    }
  });

  it("still lets a visit without money rows be removed by the functions that need to (a cleaner dropping out)", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`select private.reopen_series($1)`, [IDS.annaSeries]);
      return q.count(`public.visits where id = '${IDS.visitNextWeek}'`);
    });
    expect(r).toBe(0); // re-bookable for whoever claims next
  });

  it("stops a reopen rather than lose a future visit that somehow has a money row", async () => {
    const code = await setupThen(async (su) => { await pay(su, IDS.visitNextWeek, "test:odd"); }, null,
      (su) => su.attempt(`select private.reopen_series($1)`, [IDS.annaSeries]));
    expect(code).toBe("PC016");
  });

  it("holds payments and payouts to their visit with ON DELETE RESTRICT", async () => {
    const rows = await as("superuser", (q) => q.rows<{ name: string; rule: string }>(
      `select conname as name, confdeltype::text as rule from pg_constraint
        where conname in ('payments_visit_id_fkey', 'payouts_visit_id_fkey') order by 1`));
    expect(rows).toEqual([{ name: "payments_visit_id_fkey", rule: "r" }, { name: "payouts_visit_id_fkey", rule: "r" }]);
  });
});
