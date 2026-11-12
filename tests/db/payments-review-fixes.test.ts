// Fixes from the independent security review of payments PRs 6 to 8 (12 Nov 2026).
import { afterAll, describe, expect, it } from "vitest";
import { as, IDS, pool, U, type Query } from "./helpers";

afterAll(() => pool.end());

const today = IDS.visitToday; // Anna's clean today, Tara's (seed)
const PI = "pi_TestFix0000001";
const su = (q: Query) => q.rows(`reset role`);
const server = async (q: Query) => { await q.rows(`reset role`); await q.rows(`set local role service_role`); };

async function completed(q: Query) {
  await q.rows(`insert into private.customer_billing (customer_id, stripe_customer_id, default_payment_method_id) values ($1, 'cus_TestAnna0001', 'pm_TestAnna0001')`, [U.anna]);
  await q.actAs(U.tara);
  await q.rows(`select public.start_visit($1)`, [today]);
  await q.rows(`update public.checklist_items set done = true where visit_id = $1`, [today]);
  for (const kind of ["before", "after"]) {
    await q.rows(`insert into storage.objects (bucket_id, name, owner, metadata) values ('visit-photos', $1, auth.uid(), '{"size": 184000}')`, [`${today}/${kind}.jpg`]);
    await q.rows(`insert into public.visit_photos (visit_id, kind, storage_path, uploaded_by) values ($1, $2, $3, $4)`, [today, kind, `${today}/${kind}.jpg`, U.tara]);
  }
  await q.rows(`select public.complete_visit($1)`, [today]);
  await su(q);
}
const claim = async (q: Query) => { await server(q); const r = await q.rows<{ payment_id: string; mode: string; idempotency_key: string }>(`select * from public.charge_claim(10)`); await su(q); return r; };
async function chargeSent(q: Query) { await completed(q); await claim(q); }
async function result(q: Query, outcome: "succeeded" | "failed" | "requires_action") {
  const [p] = await q.rows<{ id: string; amount_pence: number; application_fee_pence: number; cleaner_account_id: string }>(
    `select id, amount_pence, application_fee_pence, cleaner_account_id from public.payments where visit_id = $1 and kind = 'visit'`, [today]);
  await server(q);
  const r = await q.rows<{ r: string }>(`select public.stripe_payment_result($1, $2, $3, $4, $5, $6, null, $7, null) as r`,
    [p!.id, PI, outcome, p!.amount_pence, p!.application_fee_pence, p!.cleaner_account_id, outcome === "failed" ? "card_declined" : null]);
  await su(q);
  return r[0]!.r;
}
const pay = async (q: Query) => (await q.rows<{ id: string; status: string; attempts: number; customer_tries: number; code: string | null; due: boolean; hours: number | null; key: string }>(
  `select id, status::text, attempts, customer_tries, last_error_code as code, next_retry_at <= now() as due,
          round(extract(epoch from next_retry_at - created_at) / 3600)::int as hours, idempotency_key as key
     from public.payments where visit_id = $1 and kind = 'visit'`, [today]));
const seriesStatus = async (q: Query) => (await q.rows<{ s: string }>(`select status::text as s from public.series where id = $1`, [IDS.annaSeries]))[0]!.s;

describe("1. a payment the bank wants confirmed doesn't wait for ever", () => {
  it("gets a deadline from Carl's schedule: the time of the last automatic try", async () => {
    const r = await as("superuser", async (q) => {
      await chargeSent(q);
      const said = await result(q, "requires_action");
      const [p] = await pay(q);
      return { said, status: p!.status, hours: p!.hours, due: p!.due };
    });
    expect(r).toEqual({ said: "requires_action", status: "requires_action", hours: 72, due: false });
  });

  it("past the deadline it's the last failed try: block on hold, customer emailed, team told, nothing more sent", async () => {
    const r = await as("superuser", async (q) => {
      await chargeSent(q);
      await result(q, "requires_action");
      await q.rows(`update public.payments set next_retry_at = now() - interval '1 minute' where visit_id = $1`, [today]);
      const due = (await q.rows<{ due: boolean }>(`select private.charges_due() as due`))[0]!.due;
      const claimed = await claim(q);
      const [p] = await pay(q);
      const notices = (await q.rows<{ kind: string }>(`select kind from private.customer_notices where customer_id = $1 order by kind`, [U.anna])).map((n) => n.kind);
      const alerts = (await q.rows<{ kind: string }>(`select kind from public.engine_alerts where visit_id = $1 and resolved_at is null order by kind`, [today])).map((a) => a.kind);
      return { due, claimed: claimed.length, status: p!.status, code: p!.code, series: await seriesStatus(q), notices, alerts };
    });
    expect(r).toEqual({ due: true, claimed: 0, status: "failed_final", code: "authentication_not_completed", series: "paused",
      notices: ["block_on_hold", "payment_needs_confirming"], alerts: ["payment_failed"] });
  });

  it("with no schedule set it waits for the team, as a failed charge does", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.settings set payment_retry_hours = null`);
      await chargeSent(q);
      await result(q, "requires_action");
      const [p] = await pay(q);
      return { status: p!.status, deadline: p!.hours };
    });
    expect(r).toEqual({ status: "requires_action", deadline: null });
  });

  it("confirming late still records the money and takes the block off hold", async () => {
    const r = await as("superuser", async (q) => {
      await chargeSent(q);
      await result(q, "requires_action");
      await q.rows(`update public.payments set next_retry_at = now() - interval '1 minute' where visit_id = $1`, [today]);
      await claim(q);
      const held = await seriesStatus(q);
      const said = await result(q, "succeeded");
      return { held, said, status: (await pay(q))[0]!.status, series: await seriesStatus(q) };
    });
    expect(r).toEqual({ held: "paused", said: "succeeded", status: "succeeded", series: "claimed" });
  });
});

describe("2. a block comes back on only when nothing in it is unpaid", () => {
  it("stays on hold while another clean's payment is failed or waiting on the customer", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.settings set payment_retry_hours = null`);
      await chargeSent(q);
      await result(q, "failed"); // final: on hold
      const out: Record<string, boolean> = {};
      for (const status of ["failed", "requires_action"] as const) {
        // A second clean in the block, unpaid in a state that isn't "failed for good".
        await q.rows(`alter table public.payments disable trigger user`);
        await q.rows(`insert into public.payments (visit_id, customer_id, amount_pence, application_fee_pence, cleaner_amount_pence, kind, status, idempotency_key)
                      select $1, customer_id, amount_pence, application_fee_pence, cleaner_amount_pence, 'visit', $2::public.payment_status, 'payment:test:' || $2
                        from public.payments where visit_id = $3`, [IDS.visitNextWeek, status, today]);
        await q.rows(`alter table public.payments enable trigger user`);
        out[status] = (await q.rows<{ r: boolean }>(`select private.release_payment_hold($1) as r`, [IDS.annaSeries]))[0]!.r;
        await q.rows(`alter table public.payments disable trigger user`);
        await q.rows(`delete from public.payments where visit_id = $1`, [IDS.visitNextWeek]);
        await q.rows(`alter table public.payments enable trigger user`);
      }
      return { ...out, series: await seriesStatus(q) };
    });
    expect(r).toEqual({ failed: false, requires_action: false, series: "paused" });
  });
});

describe("3. one payment row per clean", () => {
  it("charging by hand a clean whose payment failed re-queues that payment: no second row, and the job keeps running", async () => {
    const r = await as("superuser", async (q) => {
      await chargeSent(q);
      await result(q, "failed"); // will be retried in 24h
      const [before] = await pay(q);
      await q.actAs(U.admin);
      const id = (await q.rows<{ id: string }>(`select public.admin_charge_visit($1) as id`, [today]))[0]!.id;
      await su(q);
      const rows = await pay(q);
      const claimed = await claim(q);
      return { same: id === before!.id, rows: rows.length, due: rows[0]!.due, claimed: claimed.map((c) => [c.payment_id === id, c.mode]), after: (await pay(q))[0]!.status };
    });
    expect(r).toEqual({ same: true, rows: 1, due: true, claimed: [[true, "retry"]], after: "processing" });
  });

  it("the same for a payment that failed for good; and a paid or in-flight one is refused", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.settings set payment_retry_hours = null`);
      await chargeSent(q);
      await result(q, "failed"); // final
      await q.actAs(U.admin);
      await q.rows(`select public.admin_charge_visit($1)`, [today]);
      await su(q);
      const claimed = await claim(q);
      await q.actAs(U.admin);
      const inFlight = await q.attempt(`select public.admin_charge_visit($1)`, [today]);
      await su(q);
      await result(q, "succeeded");
      await q.actAs(U.admin);
      const paid = await q.attempt(`select public.admin_charge_visit($1)`, [today]);
      await su(q);
      return { claimed: claimed.length, inFlight, paid, rows: (await pay(q)).length, series: await seriesStatus(q) };
    });
    expect(r).toEqual({ claimed: 1, inFlight: "PC051", paid: "PC051", rows: 1, series: "claimed" });
  });

  it("a row that can't be prepared is set aside and the team told; the other charges still go", async () => {
    const r = await as("superuser", async (q) => {
      await completed(q);
      // A second, broken charge: its clean has gone (as an old duplicate row would be).
      await q.rows(`alter table public.payments disable trigger user`);
      await q.rows(`insert into public.payments (visit_id, customer_id, amount_pence, application_fee_pence, cleaner_amount_pence, kind, status, idempotency_key, attempts, created_at)
                    select $1, customer_id, amount_pence, application_fee_pence, cleaner_amount_pence, 'visit', 'failed', 'payment:test:dup', 10, now() - interval '1 day'
                      from public.payments where visit_id = $2`, [IDS.visitNextWeek, today]);
      await q.rows(`update public.payments set next_retry_at = now() - interval '1 minute' where visit_id = $1`, [IDS.visitNextWeek]);
      await q.rows(`alter table public.payments enable trigger user`);
      await q.rows(`update public.visits set cleaner_id = $2 where id = $1`, [IDS.visitNextWeek, U.tara]);
      const claimed = await claim(q); // attempts 10 + 1 breaks the row's own check: that row errors
      const [bad] = await q.rows<{ due: boolean; alert: number }>(
        `select p.next_retry_at <= now() as due, (select count(*)::int from public.engine_alerts a where a.visit_id = p.visit_id and a.kind = 'charge_blocked') as alert
           from public.payments p where p.visit_id = $1`, [IDS.visitNextWeek]);
      return { claimed: claimed.length, good: (await pay(q))[0]!.status, bad };
    });
    expect(r).toEqual({ claimed: 1, good: "processing", bad: { due: false, alert: 1 } });
  });
});

describe("4. the cleaner can't read why a block was held or ended", () => {
  it("skipped cleans say on_hold and the block's end reason is neutral; the why is in the team's alert", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.settings set payment_retry_hours = null`);
      await chargeSent(q);
      await result(q, "failed");
      await q.rows(`update private.series_holds set held_at = now() - interval '8 days' where series_id = $1`, [IDS.annaSeries]);
      await q.rows(`update public.visits set scheduled_date = private.london_today() - 1 where id = $1`, [IDS.visitNextWeek]);
      await q.rows(`select private.run_payment_holds()`);
      await q.actAs(U.tara);
      const seen = JSON.stringify([
        await q.rows(`select status, end_reason from public.series where id = $1`, [IDS.annaSeries]),
        await q.rows(`select status, cancel_reason from public.visits where series_id = $1`, [IDS.annaSeries]),
      ]);
      const alerts = (await q.rows(`select 1 from public.engine_alerts`)).length;
      await su(q);
      const [team] = await q.rows<{ message: string }>(`select message from public.engine_alerts where visit_id = $1 and kind = 'payment_failed'`, [today]);
      return { ended: /"ended"/.test(seen), onHold: /on_hold/.test(seen), leaks: /card|pay|unpaid|owed|fail/i.test(seen), alerts, teamKnows: /card couldn't be charged/.test(team!.message) };
    });
    expect(r).toEqual({ ended: true, onHold: true, leaks: false, alerts: 0, teamKnows: true });
  });
});

describe("5 and 6. requests Stripe wouldn't take", () => {
  it("a refused retry gives the customer the try back, waits an hour and tells the team", async () => {
    const r = await as("superuser", async (q) => {
      await chargeSent(q);
      await result(q, "failed");
      await q.rows(`update public.payments set next_retry_at = now() - interval '1 minute' where visit_id = $1`, [today]);
      await claim(q); // the 24h retry: attempts 2, processing
      const [mid] = await pay(q);
      await server(q);
      const said = (await q.rows<{ r: string }>(`select public.charge_retry_not_sent($1, 'stripe_account_invalid', false) as r`, [mid!.id]))[0]!.r;
      const again = (await q.rows<{ r: string }>(`select public.charge_retry_not_sent($1, 'stripe_account_invalid', false) as r`, [mid!.id]))[0]!.r;
      await su(q);
      const [p] = await pay(q);
      const n = (await q.rows<{ n: number }>(`select count(*)::int as n from public.engine_alerts where visit_id = $1 and kind = 'charge_blocked' and resolved_at is null`, [today]))[0]!.n;
      // Next time it's a different Stripe key, and after three days it stops trying by itself.
      const newKey = p!.key !== mid!.key && /^payment:[0-9a-f-]+:r\d+$/.test(p!.key);
      await q.rows(`alter table public.payments disable trigger user`);
      await q.rows(`update public.payments set status = 'processing', created_at = now() - interval '4 days' where id = $1`, [mid!.id]);
      await q.rows(`alter table public.payments enable trigger user`);
      await server(q);
      await q.rows(`select public.charge_retry_not_sent($1, 'stripe_account_invalid', false)`, [mid!.id]);
      await su(q);
      const [old] = await q.rows<{ waits: boolean }>(`select next_retry_at is null as waits from public.payments where id = $1`, [mid!.id]);
      return { mid: mid!.attempts, said, again, status: p!.status, attempts: p!.attempts, due: p!.due, series: await seriesStatus(q), alert: n, newKey, afterThreeDays: old!.waits };
    });
    expect(r).toEqual({ mid: 2, said: "returned", again: "ignored", status: "failed", attempts: 1, due: false, series: "claimed", alert: 1, newKey: true, afterThreeDays: true });
  });

  it("after a refused first send the next send has a new Stripe key", async () => {
    const r = await as("superuser", async (q) => {
      await completed(q);
      const [first] = await claim(q);
      await server(q);
      await q.rows(`select public.charge_not_sent($1, 'stripe_invalid_request')`, [first!.payment_id]);
      await su(q);
      await q.rows(`update public.payments set next_retry_at = now() - interval '1 minute' where visit_id = $1`, [today]);
      const [second] = await claim(q);
      return { mode: second!.mode, first: first!.idempotency_key === `payment:${first!.payment_id}`, second: second!.idempotency_key === `payment:${first!.payment_id}:c1` };
    });
    expect(r).toEqual({ mode: "create", first: true, second: true });
  });

  it("is server only", async () => {
    for (const who of ["tara", "anna", "admin", "anon"] as const) {
      expect({ who, code: await as(who, (q) => q.attempt(`select public.charge_retry_not_sent(gen_random_uuid(), 'x', false)`)) }).toEqual({ who, code: "42501" });
    }
  });
});
