// A customer cancels a clean, or the rest of their block: only their own, free with notice,
// late without it (when a cleaner has the clean), and never a clean that's under way or done.
import { afterAll, describe, expect, it } from "vitest";
import { as, DENIED, IDS, pool, U, type Query } from "./helpers";

afterAll(() => pool.end());

const next = IDS.visitNextWeek; // Anna's clean a week from today, Tara's (seed)
const today = IDS.visitToday;
const su = (q: Query) => q.rows(`reset role`);
const visit = async (q: Query, id: string = next) => (await q.rows<{ status: string; cancel_reason: string | null; fee: number; by: string | null }>(
  `select status::text, cancel_reason, late_cancel_fee_pence as fee, cancelled_by as by from public.visits where id = $1`, [id]))[0]!;
const terms = async (q: Query, id: string = next) => (await q.rows<{ can_cancel: boolean; late: boolean; notice_hours: number | null; fee_pence: number | null }>(
  `select * from public.my_cancel_terms($1)`, [id]))[0];
const cancel = async (q: Query, id: string = next) => (await q.rows<{ r: string }>(`select public.cancel_my_visit($1) as r`, [id]))[0]!.r;
const lateAlerts = (q: Query) => q.rows<{ visit_id: string; message: string }>(`select visit_id, message from public.engine_alerts where kind = 'cancelled_late' and resolved_at is null`);
/** Puts the clean's arrival window `hours` from now (London time), moving any other clean of the block off that day. */
async function startsIn(q: Query, hours: number, id: string = next) {
  const at = `((now() + $2 * interval '1 hour') at time zone 'Europe/London')`;
  await q.rows(`update public.visits o set scheduled_date = o.scheduled_date - 300
                 where o.id <> $1 and o.series_id = (select series_id from public.visits where id = $1) and o.scheduled_date = ${at}::date`, [id, hours]);
  await q.rows(`update public.visits set scheduled_date = ${at}::date, window_start = date_trunc('minute', ${at})::time,
                       window_end = case when ${at}::time >= time '23:58' then time '23:59:59' else date_trunc('minute', ${at})::time + interval '1 minute' end
                 where id = $1`, [id, hours]);
}

describe("cancelling one clean", () => {
  it("is free with notice: the clean is cancelled, nobody is alerted, nothing is owed", async () => {
    const r = await as("superuser", async (q) => {
      await q.actAs(U.anna);
      const before = await terms(q);
      const first = await cancel(q);
      const again = await cancel(q); // pressed twice
      await su(q);
      return { before, first, again, v: await visit(q), alerts: (await lateAlerts(q)).length,
        series: (await q.rows<{ s: string }>(`select status::text as s from public.series where id = $1`, [IDS.annaSeries]))[0]!.s,
        payments: await q.count(`public.payments where visit_id = '${next}'`) };
    });
    expect(r).toEqual({ before: { can_cancel: true, late: false, notice_hours: 24, fee_pence: null }, first: "cancelled", again: "cancelled",
      v: { status: "cancelled", cancel_reason: "customer", fee: 0, by: U.anna }, alerts: 0, series: "claimed", payments: 0 });
  });

  it("inside the notice period is late: the office is told to ring the cleaner; with no fee set, nothing is owed", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.settings set late_cancel_fee_pence = null`); // as production is today (the seed has a test fee)
      await startsIn(q, 5);
      await q.actAs(U.anna);
      const before = await terms(q);
      const out = await cancel(q);
      await su(q);
      return { before, out, v: await visit(q), alerts: await lateAlerts(q) };
    });
    expect(r.before).toEqual({ can_cancel: true, late: true, notice_hours: 24, fee_pence: null });
    expect(r.out).toBe("cancelled_late");
    expect(r.v).toEqual({ status: "cancelled", cancel_reason: "customer_late", fee: 0, by: U.anna });
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]!.message).toMatch(/less than 24 hours' notice\. Ring the cleaner.*No late fee is set/);
  });

  it("records Carl's late fee on the clean once one is set, and says it isn't charged automatically", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.settings set late_cancel_fee_pence = 1500`);
      await startsIn(q, 5);
      await q.actAs(U.anna);
      const before = await terms(q);
      await cancel(q);
      await su(q);
      return { fee: before!.fee_pence, v: await visit(q), message: (await lateAlerts(q))[0]!.message, payments: await q.count(`public.payments where visit_id = '${next}'`) };
    });
    expect(r.fee).toBe(1500);
    expect(r.v).toMatchObject({ cancel_reason: "customer_late", fee: 1500 });
    expect(r.message).toMatch(/A late fee of £15\.00 is due; it isn't taken from the card automatically yet\./);
    expect(r.payments).toBe(0);
  });

  it("is never late when no cleaner has the clean, or when no notice period is set", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.settings set late_cancel_fee_pence = 1500`);
      await startsIn(q, 5);
      await q.rows(`update public.settings set cancel_notice_hours = null`);
      await q.actAs(U.anna);
      const noRule = await terms(q);
      await su(q);
      await q.rows(`update public.settings set cancel_notice_hours = 24`);
      await q.rows(`update public.visits set cleaner_id = null where id = $1`, [next]);
      await q.actAs(U.anna);
      return { noRule: [noRule!.late, noRule!.fee_pence], noCleaner: await terms(q), out: await cancel(q) };
    });
    expect(r).toEqual({ noRule: [false, null], noCleaner: { can_cancel: true, late: false, notice_hours: 24, fee_pence: null }, out: "cancelled" });
  });

  it("counts notice to the start of the arrival window, to the hour", async () => {
    const r = await as("superuser", async (q) => {
      await startsIn(q, 25);
      await q.actAs(U.anna);
      const justOutside = (await terms(q))!.late;
      await su(q);
      await startsIn(q, 23);
      await q.actAs(U.anna);
      return { justOutside, justInside: (await terms(q))!.late };
    });
    expect(r).toEqual({ justOutside: false, justInside: true });
  });

  it("refuses a clean that's under way or finished", async () => {
    const r = await as("superuser", async (q) => {
      await q.actAs(U.tara);
      await q.rows(`select public.start_visit($1)`, [today]);
      await q.actAs(U.anna);
      return { underWay: [(await terms(q, today))!.can_cancel, await q.attempt(`select public.cancel_my_visit($1)`, [today])],
               done: [(await terms(q, IDS.visitDone))!.can_cancel, await q.attempt(`select public.cancel_my_visit($1)`, [IDS.visitDone])] };
    });
    expect(r).toEqual({ underWay: [false, "PC061"], done: [false, "PC061"] });
  });

  it("is only ever the customer's own clean", async () => {
    for (const who of ["ben", "tara", "admin"] as const) {
      const r = await as(who, async (q) => ({ terms: await terms(q), cancel: await q.attempt(`select public.cancel_my_visit($1)`, [next]),
        block: await q.attempt(`select * from public.cancel_my_block($1)`, [IDS.annaSeries]) }));
      expect({ who, ...r }).toEqual({ who, terms: undefined, cancel: "PC060", block: "PC060" });
    }
    const anon = await as("anon", async (q) => [
      await q.attempt(`select * from public.my_cancel_terms($1)`, [next]), await q.attempt(`select public.cancel_my_visit($1)`, [next]),
      await q.attempt(`select * from public.cancel_my_block($1)`, [IDS.annaSeries]), await q.attempt(`select private.cancel_visit_for_customer($1, $2)`, [next, U.anna]),
    ]);
    expect(anon).toEqual([DENIED, DENIED, DENIED, DENIED]);
    const still = await as("superuser", (q) => visit(q));
    expect(still.status).toBe("scheduled");
    expect(await as("anna", (q) => q.attempt(`select private.cancel_visit_for_customer($1, $2)`, [next, U.anna]))).toBe(DENIED);
  });

  it("ends the block when the last clean left is cancelled", async () => {
    const r = await as("superuser", async (q) => {
      const left = await q.rows<{ id: string }>(`select id from public.visits where series_id = $1 and status = 'scheduled' and id <> $2`, [IDS.annaSeries, next]);
      await q.rows(`update public.visits set status = 'cancelled', cancelled_at = now(), cancel_reason = 'admin' where id = any($1)`, [left.map((x) => x.id)]);
      await q.actAs(U.anna);
      await cancel(q);
      await su(q);
      const [s] = await q.rows<{ status: string; planned: number; have: number }>(
        `select s.status::text, s.block_size as planned, (select count(*)::int from public.visits v where v.series_id = s.id) as have from public.series s where s.id = $1`, [IDS.annaSeries]);
      return s!;
    });
    // The block ends by itself only once every clean it planned exists and none is still to come.
    expect(r.status).toBe(r.have >= r.planned ? "ended" : "claimed");
  });
});

describe("cancelling the rest of the block", () => {
  it("cancels every clean still to come, marks the late ones, withdraws offers and ends the block", async () => {
    const r = await as("superuser", async (q) => {
      await startsIn(q, 5); // next week's clean is now a few hours away: late
      const toCome = await q.count(`public.visits where series_id = '${IDS.annaSeries}' and status = 'scheduled'`);
      await q.actAs(U.anna);
      const [out] = await q.rows<{ cancelled: number; late: number }>(`select * from public.cancel_my_block($1)`, [IDS.annaSeries]);
      const [again] = await q.rows<{ cancelled: number; late: number }>(`select * from public.cancel_my_block($1)`, [IDS.annaSeries]);
      await su(q);
      const [s] = await q.rows<{ status: string; end_reason: string }>(`select status::text, end_reason from public.series where id = $1`, [IDS.annaSeries]);
      return { toCome, out, again, s, left: await q.count(`public.visits where series_id = '${IDS.annaSeries}' and status = 'scheduled'`),
        v: await visit(q), done: (await visit(q, IDS.visitDone)).status, alerts: (await lateAlerts(q)).map((a) => a.visit_id),
        offers: await q.count(`public.job_offers where series_id = '${IDS.annaSeries}' and status in ('open', 'pending')`) };
    });
    expect(r.out!.cancelled).toBe(r.toCome);
    expect(r.out!.late).toBeGreaterThanOrEqual(1);
    expect(r).toMatchObject({ again: { cancelled: 0, late: 0 }, s: { status: "ended", end_reason: "Cancelled by the customer" }, left: 0,
      v: { status: "cancelled", cancel_reason: "customer_late", by: U.anna }, done: "completed", offers: 0 });
    expect(r.alerts).toContain(next);
  });

  it("works for a block no cleaner has taken yet, and it stops being offered", async () => {
    const r = await as("superuser", async (q) => {
      const [b] = await q.rows<{ id: string; status: string }>(`select id, status::text from public.series where customer_id = $1 and status <> 'ended' limit 1`, [U.ben]);
      await q.actAs(U.ben);
      const [out] = await q.rows<{ cancelled: number; late: number }>(`select * from public.cancel_my_block($1)`, [b!.id]);
      await su(q);
      const [s] = await q.rows<{ status: string }>(`select status::text from public.series where id = $1`, [b!.id]);
      return { was: b!.status, late: out!.late, now: s!.status, offers: await q.count(`public.job_offers where series_id = '${b!.id}' and status in ('open', 'pending')`),
        alerts: (await lateAlerts(q)).length };
    });
    expect(r).toMatchObject({ late: 0, now: "ended", offers: 0, alerts: 0 });
  });

  it("leaves a clean that's under way to finish", async () => {
    const r = await as("superuser", async (q) => {
      await q.actAs(U.tara);
      await q.rows(`select public.start_visit($1)`, [today]);
      await q.actAs(U.anna);
      await q.rows(`select * from public.cancel_my_block($1)`, [IDS.annaSeries]);
      await su(q);
      return { underWay: (await visit(q, today)).status };
    });
    expect(r).toEqual({ underWay: "in_progress" });
  });
});
