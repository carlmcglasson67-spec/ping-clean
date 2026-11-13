// Cancel the rest of my cleans: every clean still to come is cancelled as cancel_visit would, then the block ends.
import { afterAll, describe, expect, it } from "vitest";
import { as, DENIED, IDS, pool, U, type Query } from "./helpers";

afterAll(() => pool.end());

const su = (q: Query) => q.rows(`reset role`);
const series = IDS.annaSeries; // Anna's block, held by Tara: one clean done, one today, one next week (seed)

const fee = async (q: Query, pence: number | null) => {
  await q.rows(`alter table public.settings disable trigger user`);
  await q.rows(`update public.settings set late_cancel_fee_pence = $1, late_cancel_split = 'same_as_clean', late_cancel_cleaner_share_bps = null`, [pence]);
  await q.rows(`alter table public.settings enable trigger user`);
};
/** Today's clean (seed) moves so its window opens this many hours from now (London). */
const todayStartsIn = (q: Query, hours: number) =>
  q.rows(`update public.visits set scheduled_date = ((now() + $2 * interval '1 hour') at time zone 'Europe/London')::date,
           window_start = ((now() + $2 * interval '1 hour') at time zone 'Europe/London')::time(0), window_end = '23:59:59' where id = $1`, [IDS.visitToday, hours]);
const quote = async (q: Query, who: string = U.anna, s: string = series) => {
  await q.actAs(who);
  const r = await q.failure(`select 1 from public.cancel_block_quote($1)`, [s]);
  const rows = r ? [] : await q.rows<{ can_cancel: boolean; cleans: number; late: number; fee_pence: number; under_way: number }>(`select * from public.cancel_block_quote($1)`, [s]);
  await su(q);
  return r?.code ?? rows[0]!;
};
const cancel = async (q: Query, shown: number, who: string = U.anna, s: string = series) => {
  await q.actAs(who);
  const f = await q.failure(`select public.cancel_block($1, $2)`, [s, shown]);
  const n = f ? null : (await q.rows<{ n: number }>(`select count(*)::int as n from public.visits where series_id = $1 and status = 'cancelled' and cancelled_by = $2`, [s, who]))[0]!.n;
  await su(q);
  return f?.code ?? n;
};
const state = async (q: Query, s: string = series) => ({
  series: (await q.rows<{ status: string; end_reason: string | null }>(`select status::text, end_reason from public.series where id = $1`, [s]))[0]!,
  visits: (await q.rows<{ status: string; cancel_reason: string | null }>(`select status::text, cancel_reason from public.visits where series_id = $1 order by scheduled_date`, [s])),
  fees: await q.rows<{ amount_pence: number; cleaner_amount_pence: number; application_fee_pence: number }>(
    `select p.amount_pence, p.cleaner_amount_pence, p.application_fee_pence from public.payments p join public.visits v on v.id = p.visit_id where v.series_id = $1 and p.kind = 'late_cancel'`, [s]),
  lateAlerts: (await q.rows(`select 1 from public.engine_alerts where series_id = $1 and kind = 'visit_cancelled_late' and resolved_at is null`, [s])).length,
  closedAlerts: (await q.rows(`select 1 from public.engine_alerts where series_id = $1 and kind = 'block_closed' and resolved_at is null`, [s])).length,
  openOffers: (await q.rows(`select 1 from public.job_offers where series_id = $1 and status in ('open', 'pending')`, [s])).length,
});

describe("cancelling the rest with plenty of notice", () => {
  it("is free: every clean to come is cancelled, the finished one is untouched, the block ends and the office is told", async () => {
    const r = await as("superuser", async (q) => {
      await fee(q, 2000);
      await todayStartsIn(q, 72);
      const told = await quote(q);
      const done = await cancel(q, 0);
      return { told, done, after: await state(q) };
    });
    expect(r.told).toEqual({ can_cancel: true, cleans: 2, late: 0, fee_pence: 0, under_way: 0 });
    expect(r.done).toBe(2);
    expect(r.after.series.status).toBe("ended");
    expect(r.after.series.end_reason).toMatch(/customer cancelled the rest/i);
    expect(r.after.visits).toEqual([
      { status: "completed", cancel_reason: null },
      { status: "cancelled", cancel_reason: "customer" },
      { status: "cancelled", cancel_reason: "customer" },
    ]);
    expect(r.after.fees).toEqual([]);
    expect(r.after.lateAlerts).toBe(0);
    expect(r.after.closedAlerts).toBe(1);
  });
});

describe("cancelling the rest when one clean is at short notice", () => {
  it("charges that clean's fee only, at the total the customer saw, split like the clean", async () => {
    const r = await as("superuser", async (q) => {
      await fee(q, 2000);
      await todayStartsIn(q, 5);
      const told = await quote(q);
      const stale = await cancel(q, 0); // they were shown "free" before the cut-off passed
      const untouched = await state(q);
      const done = await cancel(q, 2000);
      return { told, stale, untouched, done, after: await state(q) };
    });
    expect(r.told).toEqual({ can_cancel: true, cleans: 2, late: 1, fee_pence: 2000, under_way: 0 });
    expect(r.stale).toBe("PC035");
    expect(r.untouched.series.status).toBe("claimed");
    expect(r.untouched.visits.filter((v) => v.status === "cancelled")).toEqual([]);
    expect(r.done).toBe(2);
    expect(r.after.visits.map((v) => v.cancel_reason).sort()).toEqual(["customer", "customer_late", null].sort());
    expect(r.after.fees).toEqual([{ amount_pence: 2000, cleaner_amount_pence: 1500, application_fee_pence: 500 }]);
    expect(r.after.lateAlerts).toBe(1);
    expect(r.after.series.status).toBe("ended");
  });

  it("with no fee set, short notice costs nothing", async () => {
    const r = await as("superuser", async (q) => {
      await fee(q, null);
      await todayStartsIn(q, 5);
      return { told: await quote(q), done: await cancel(q, 0), after: await state(q) };
    });
    expect(r.told).toMatchObject({ late: 1, fee_pence: 0 });
    expect(r.done).toBe(2);
    expect(r.after.fees).toEqual([]);
    expect(r.after.lateAlerts).toBe(1);
  });
});

describe("when it can't be done", () => {
  it("a clean under way, or whose time has started, keeps the block: nothing is cancelled", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.visits set status = 'in_progress', started_at = now() where id = $1`, [IDS.visitToday]);
      const told = await quote(q);
      const going = await cancel(q, 0);
      await q.rows(`update public.visits set status = 'scheduled', started_at = null where id = $1`, [IDS.visitToday]);
      await todayStartsIn(q, -1);
      const started = await cancel(q, 0);
      return { told, going, started, after: await state(q) };
    });
    expect(r.told).toMatchObject({ can_cancel: false, cleans: 1, under_way: 1 });
    expect(r.going).toBe("PC055");
    expect(r.started).toBe("PC055");
    expect(r.after.series.status).toBe("claimed");
    expect(r.after.visits.filter((v) => v.status === "cancelled")).toEqual([]);
  });

  it("an old clean the office still has to settle doesn't lock the customer out, and is left as it is", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.visits set status = 'in_progress', started_at = now() - interval '3 days', scheduled_date = scheduled_date - 3 where id = $1`, [IDS.visitToday]);
      const told = await quote(q);
      const done = await cancel(q, 0);
      return { told, done, after: await state(q) };
    });
    expect(r.told).toMatchObject({ can_cancel: true, cleans: 1, under_way: 0 });
    expect(r.done).toBe(1);
    expect(r.after.series.status).toBe("ended");
    expect(r.after.visits.map((v) => v.status).sort()).toEqual(["cancelled", "completed", "in_progress"]);
  });

  it("a block on hold for an unpaid clean can still be cancelled; the unpaid payment stays owed", async () => {
    const r = await as("superuser", async (q) => {
      await todayStartsIn(q, 72);
      await q.rows(`alter table public.series disable trigger user`);
      await q.rows(`update public.series set status = 'paused' where id = $1`, [series]);
      await q.rows(`alter table public.series enable trigger user`);
      const owedBefore = (await q.rows(`select 1 from public.payments p join public.visits v on v.id = p.visit_id where v.series_id = $1`, [series])).length;
      const told = await quote(q);
      const done = await cancel(q, 0);
      const owedAfter = (await q.rows(`select 1 from public.payments p join public.visits v on v.id = p.visit_id where v.series_id = $1`, [series])).length;
      return { told, done, owedBefore, owedAfter, after: await state(q) };
    });
    expect(r.told).toMatchObject({ can_cancel: true, cleans: 2, fee_pence: 0 }); // on hold: nobody is holding the time, so no fee
    expect(r.done).toBe(2);
    expect(r.after.series.status).toBe("ended");
    expect(r.owedAfter).toBe(r.owedBefore);
    expect(r.after.fees).toEqual([]);
  });

  it("only the block's own customer: another customer, the cleaner, the admin and anon are refused", async () => {
    const r = await as("superuser", async (q) => {
      await todayStartsIn(q, 72);
      return {
        benQuote: await quote(q, U.ben), ben: await cancel(q, 0, U.ben),
        tara: await cancel(q, 0, U.tara), admin: await cancel(q, 0, U.admin),
        after: await state(q),
      };
    });
    expect(r.benQuote).toBe("PC054");
    expect(r.ben).toBe("PC054");
    expect(r.tara).toBe(DENIED);
    expect(r.admin).toBe(DENIED);
    expect(r.after.series.status).toBe("claimed");
    const anon = await as("anon", (q) => q.attempt(`select public.cancel_block($1, 0)`, [series]));
    expect(anon).toBe(DENIED);
  });

  it("a block that has already ended can't be cancelled again", async () => {
    const r = await as("superuser", async (q) => {
      await todayStartsIn(q, 72);
      const first = await cancel(q, 0);
      return { first, again: await cancel(q, 0), told: await quote(q) };
    });
    expect(r.first).toBe(2);
    expect(r.again).toBe("PC054");
    expect(r.told).toMatchObject({ can_cancel: false });
  });
});

describe("the fee that was checked is the fee that's charged", () => {
  it("cancel_one never reads the settings: it charges exactly the terms it is handed", async () => {
    const r = await as("superuser", async (q) => {
      await fee(q, 2000);
      await todayStartsIn(q, 5);
      // The terms as checked (late, £20 = £15 + £5)... then the setting changes before the clean is cancelled.
      await fee(q, 9900);
      await q.rows(`select private.cancel_one($1, $2, true, 2000, 1500, 500)`, [IDS.visitToday, U.anna]);
      return state(q);
    });
    expect(r.fees).toEqual([{ amount_pence: 2000, cleaner_amount_pence: 1500, application_fee_pence: 500 }]);
  });

  it("cancel_one can't be called by a signed-in person", async () => {
    const code = await as("anna", (q) => q.attempt(`select private.cancel_one($1, $2, false, 0, 0, 0)`, [IDS.visitToday, U.anna]));
    expect(code).toBe(DENIED);
  });
});

describe("a block still out on offer", () => {
  it("is taken off the board: offers withdrawn, the block ends, nothing to pay", async () => {
    const r = await as("superuser", async (q) => {
      await fee(q, 2000);
      const before = await state(q, IDS.benSeries);
      const told = await quote(q, U.ben, IDS.benSeries);
      const done = await cancel(q, 0, U.ben, IDS.benSeries);
      return { before, told, done, after: await state(q, IDS.benSeries) };
    });
    expect(r.before.openOffers).toBeGreaterThan(0);
    expect(r.told).toMatchObject({ can_cancel: true, fee_pence: 0 });
    expect(typeof r.done).toBe("number");
    expect(r.after.series.status).toBe("ended");
    expect(r.after.openOffers).toBe(0);
    expect(r.after.fees).toEqual([]);
  });
});
