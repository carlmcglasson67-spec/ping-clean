// Blocks follow-ups (issue #12 notes 1-4, last item of #60): intent/blocks-followups/plan.md.
import { afterAll, describe, expect, it } from "vitest";
import { as, cardsOnFile, IDS, pool, setupThen, U, type Query } from "./helpers";

afterAll(() => pool.end());
cardsOnFile();

/** A charge on one of Anna's cleans, as the charge job writes one (the seed's split). */
const pay = async (su: Query, visit: string, key: string) =>
  (await su.rows<{ id: string }>(
    `insert into public.payments (visit_id, customer_id, amount_pence, application_fee_pence, cleaner_amount_pence, idempotency_key)
     values ($1, $2, 5000, 1250, 3750, $3) returning id`, [visit, U.anna, key]))[0]!.id;
/** A succeeded charge and Tara's payout from it, on the same clean. */
const payAndPayOut = async (su: Query, visit: string, key: string) => {
  const p = await pay(su, visit, `${key}:charge`);
  await su.rows(`update public.payments set status = 'processing' where id = $1`, [p]);
  await su.rows(`update public.payments set status = 'succeeded' where id = $1`, [p]);
  if ((await su.count(`public.payouts where visit_id = '${visit}'`)) === 0) {
    await su.rows(`insert into public.payouts (visit_id, cleaner_id, payment_id, amount_pence, available_after, idempotency_key)
                   values ($1, $2, $3, 3750, now() + interval '3 days', $4)`, [visit, U.tara, p, key]);
  }
};

describe("note 1: ending a block never fails on money rows", () => {
  it("the engine closes a block whose future cleans have a payment and a payout, keeping them all", async () => {
    const r = await as("superuser", async (q) => {
      await pay(q, IDS.visitToday, "test:followups:today");
      await payAndPayOut(q, IDS.visitNextWeek, "test:followups:next-week");
      const end = await q.attempt(`select private.close_block($1, null, 'This block had no cleans left to give.')`, [IDS.annaSeries]);
      const visits = await q.rows<{ status: string }>(
        `select status::text from public.visits where id in ($1, $2) order by scheduled_date`, [IDS.visitToday, IDS.visitNextWeek]);
      return {
        end, visits: visits.map((v) => v.status),
        payments: await q.count(`public.payments where visit_id in ('${IDS.visitToday}', '${IDS.visitNextWeek}')`),
        payouts: await q.count(`public.payouts where visit_id = '${IDS.visitNextWeek}'`),
        status: (await q.rows<{ status: string }>(`select status from public.series where id = $1`, [IDS.annaSeries]))[0]!.status,
      };
    });
    expect(r).toEqual({ end: "ok", visits: ["cancelled", "cancelled"], payments: 2, payouts: 1, status: "ended" });
  });
});

describe("note 2: the overlap alert closes only when every clean really is booked", () => {
  it("on the nightly run's 28-day horizon, the rest of the block is booked when the block in the way goes", async () => {
    const r = await as("superuser", async (q) => {
      await q.actAs(U.admin);
      await q.rows(`select public.admin_assign_series($1, $2)`, [IDS.benSeries, U.tara]);
      await q.rows(`select public.admin_reopen_series($1)`, [IDS.benSeries]);
      await q.rows(`reset role`);
      // Block B at Ben's home starts the day after A's 2nd clean: A loses its last two.
      const bId = (await q.rows<{ id: string }>(`insert into public.series (property_id, customer_id, cleaner_id, frequency, preferred_day, window_start, window_end,
                      duration_minutes, price_per_hour_pence, commission_type, commission_value, status, starts_on, claimed_at, offering_since, block_size)
                    select $1, $2, $3, 'weekly', extract(isodow from d)::smallint, '10:00', '14:00', 120, 2000, 'percent', 2500, 'claimed', d, now(), null, 1
                    from (select private.block_first_date(starts_on, preferred_day) + 15 as d from public.series where id = $4) x
                    returning id`, [IDS.benProperty, U.ben, U.alex, IDS.benSeries]))[0]!.id;
      await q.actAs(U.admin);
      await q.rows(`select public.admin_assign_series($1, $2)`, [IDS.benSeries, U.tara]);
      await q.rows(`reset role`);
      const cut = (await q.rows<{ c: number }>(`select cut_short_cleans as c from public.series where id = $1`, [IDS.benSeries]))[0]!.c;
      await q.rows(`update public.series set status = 'ended' where id = $1`, [bId]);
      // The nightly run: books only 28 days ahead on its own.
      await q.rows(`select private.generate_visits_for_series($1, private.london_today() + 28)`, [IDS.benSeries]);
      const after = (await q.rows<{ c: number; n: number; last: number; ends: number }>(
        `select cut_short_cleans as c,
                (select count(*)::int from public.visits where series_id = $1) as n,
                (select max(scheduled_date) - private.london_today() from public.visits where series_id = $1) as last,
                ends_on - private.london_today() as ends
           from public.series where id = $1`, [IDS.benSeries]))[0]!;
      const alert = (await q.rows<{ resolved: boolean; by: string | null; message: string }>(
        `select resolved_at is not null as resolved, resolved_by::text as by, message from public.engine_alerts
          where kind = 'block_overlap' and series_id = $1`, [IDS.benSeries]))[0]!;
      return { cut, after, alert };
    });
    expect(r.cut).toBe(2);
    expect(r.after.c).toBe(0);
    expect(r.after.n).toBe(4); // the whole block, not just the next 28 days
    expect(r.after.last).toBeGreaterThan(28);
    expect(r.after.ends).toBe(r.after.last);
    expect(r.alert).toEqual({
      resolved: true, by: null,
      message: "No longer short: the block in the way has gone, so every clean of this block is booked again.",
    });
  });
});

describe("note 3: a block the engine closes leaves no old alerts open", () => {
  it("resolves its overlap and stalled alerts with no admin named, and raises block_closed", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`insert into public.engine_alerts (kind, series_id, message) values ('block_overlap', $1, 'short'), ('block_stalled', $1, 'stalled')`, [IDS.annaSeries]);
      await q.rows(`insert into public.engine_alerts (kind, series_id, message) values ('block_stalled', $1, 'other block')`, [IDS.benSeries]);
      await q.rows(`select private.close_block($1, null, 'The customer cancelled the rest of their cleans (2).')`, [IDS.annaSeries]);
      return q.rows<{ series_id: string; kind: string; resolved: boolean; by: string | null }>(
        `select series_id::text, kind, resolved_at is not null as resolved, resolved_by::text as by
           from public.engine_alerts where series_id in ($1, $2) order by series_id, kind`, [IDS.annaSeries, IDS.benSeries]);
    });
    expect(r).toEqual([
      { series_id: IDS.annaSeries, kind: "block_closed", resolved: false, by: null },
      { series_id: IDS.annaSeries, kind: "block_overlap", resolved: true, by: null },
      { series_id: IDS.annaSeries, kind: "block_stalled", resolved: true, by: null },
      { series_id: IDS.benSeries, kind: "block_stalled", resolved: false, by: null }, // another block's: untouched
    ]);
  });
});

describe("note 4: claiming a block the admin just ended", () => {
  const taraOffer = `(select id from public.job_offers where series_id = '${IDS.benSeries}' and cleaner_id = '${U.tara}')`;

  it("says the job is no longer open (PC003), not that another cleaner got it", async () => {
    const code = await setupThen(async (su) => {
      await su.actAs(U.admin);
      await su.rows(`select public.admin_end_block($1, 'Customer moving house')`, [IDS.benSeries]);
      await su.rows(`reset role`);
    }, U.tara, (q) => q.attempt(`select public.claim_series(${taraOffer})`));
    expect(code).toBe("PC003");
  });

  it("still says PC002 when another cleaner really did claim it first", async () => {
    const code = await setupThen(async (su) => {
      await su.rows(`insert into public.job_offers (series_id, cleaner_id, tier, opens_at, status) values ($1, $2, 'approved', now(), 'open')`, [IDS.benSeries, U.alex]);
      await su.actAs(U.tara);
      await su.rows(`select public.claim_series(${taraOffer})`);
      await su.rows(`reset role`);
    }, U.alex, (q) => q.attempt(`select public.claim_series((select id from public.job_offers where series_id = '${IDS.benSeries}' and cleaner_id = '${U.alex}'))`));
    expect(code).toBe("PC002");
  });
});
