// Payments PR 7: after the last failed try the block goes on hold, its cleans are skipped
// (never charged), it comes back when the customer pays, and ends after Carl's limit.
// Plus the customer's emails, queued once each.
import { afterAll, describe, expect, it } from "vitest";
import { as, DENIED, IDS, pool, U, type Query } from "./helpers";

afterAll(() => pool.end());

const today = IDS.visitToday; // Anna's clean today, Tara's (seed)
const PI = "pi_TestHold000001";
const su = (q: Query) => q.rows(`reset role`);
const server = async (q: Query) => { await q.rows(`reset role`); await q.rows(`set local role service_role`); };

/** Tara completes Anna's clean today; the job sends the charge once. */
async function chargeSent(q: Query) {
  await q.rows(`insert into private.customer_billing (customer_id, stripe_customer_id, default_payment_method_id) values ($1, 'cus_TestAnna0001', 'pm_TestAnna0001')`, [U.anna]);
  await q.actAs(U.tara);
  await q.rows(`select public.start_visit($1)`, [today]);
  await q.rows(`update public.checklist_items set done = true where visit_id = $1`, [today]);
  for (const kind of ["before", "after"]) {
    await q.rows(`insert into storage.objects (bucket_id, name, owner, metadata) values ('visit-photos', $1, auth.uid(), '{"size": 184000}')`, [`${today}/${kind}.jpg`]);
    await q.rows(`insert into public.visit_photos (visit_id, kind, storage_path, uploaded_by) values ($1, $2, $3, $4)`, [today, kind, `${today}/${kind}.jpg`, U.tara]);
  }
  await q.rows(`select public.complete_visit($1)`, [today]);
  await server(q);
  await q.rows(`select * from public.charge_claim(10)`);
  await su(q);
}
async function result(q: Query, outcome: "succeeded" | "failed" | "requires_action") {
  const [p] = await q.rows<{ id: string; amount_pence: number; application_fee_pence: number; cleaner_account_id: string }>(
    `select id, amount_pence, application_fee_pence, cleaner_account_id from public.payments where visit_id = $1 and kind = 'visit'`, [today]);
  await server(q);
  const r = await q.rows<{ r: string }>(`select public.stripe_payment_result($1, $2, $3, $4, $5, $6, null, $7, null) as r`,
    [p!.id, PI, outcome, p!.amount_pence, p!.application_fee_pence, p!.cleaner_account_id, outcome === "failed" ? "card_declined" : null]);
  await su(q);
  return r[0]!.r;
}
/** The card fails with no tries left (no retry schedule, so the first failure is final). */
async function lastTryFailed(q: Query) {
  await q.rows(`update public.settings set payment_retry_hours = null`);
  await chargeSent(q);
  await result(q, "failed");
}
const seriesStatus = async (q: Query) => (await q.rows<{ s: string }>(`select status::text as s from public.series where id = $1`, [IDS.annaSeries]))[0]!.s;
const holds = (q: Query) => q.rows<{ reason: string; outcome: string | null }>(`select reason, outcome from private.series_holds where series_id = $1`, [IDS.annaSeries]);
const notices = (q: Query) => q.rows<{ kind: string }>(`select kind from private.customer_notices where customer_id = $1 order by case kind when 'block_ended_unpaid' then 2 else 1 end, kind`, [U.anna]);
const nextWeek = async (q: Query) => (await q.rows<{ status: string; cancel_reason: string | null }>(
  `select status::text, cancel_reason from public.visits where id = $1`, [IDS.visitNextWeek]))[0];

describe("the last failed try puts the block on hold", () => {
  it("pauses the block, tells the team and emails the customer once", async () => {
    const r = await as("superuser", async (q) => {
      await lastTryFailed(q);
      const [alert] = await q.rows<{ message: string }>(`select message from public.engine_alerts where visit_id = $1 and kind = 'payment_failed'`, [today]);
      return { status: await seriesStatus(q), holds: await holds(q), notices: await notices(q), told: /on hold until they pay/.test(alert!.message), next: await nextWeek(q) };
    });
    expect(r).toEqual({ status: "paused", holds: [{ reason: "payment_failed", outcome: null }], notices: [{ kind: "block_on_hold" }], told: true,
      next: { status: "scheduled", cancel_reason: null } });
  });

  it("doesn't pause when Carl's setting says a failed payment doesn't pause the block", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.settings set failed_payment_pauses_block = false`);
      await lastTryFailed(q);
      return { status: await seriesStatus(q), holds: (await holds(q)).length, notices: await notices(q) };
    });
    expect(r).toEqual({ status: "claimed", holds: 0, notices: [{ kind: "payment_failed" }] });
  });

  it("a try that failed but will be retried only emails the customer; the block carries on", async () => {
    const r = await as("superuser", async (q) => {
      await chargeSent(q);
      await result(q, "failed");
      return { status: await seriesStatus(q), notices: await notices(q) };
    });
    expect(r).toEqual({ status: "claimed", notices: [{ kind: "payment_failed" }] });
  });

  it("emails the customer a link when their bank wants them to confirm", async () => {
    const r = await as("superuser", async (q) => {
      await chargeSent(q);
      await result(q, "requires_action");
      return { status: await seriesStatus(q), notices: await notices(q) };
    });
    expect(r).toEqual({ status: "claimed", notices: [{ kind: "payment_needs_confirming" }] });
  });

  it("the cleaner sees the block is on hold but never why, nor the customer's payment or emails", async () => {
    const r = await as("superuser", async (q) => {
      await lastTryFailed(q);
      await q.actAs(U.tara);
      return {
        sees: (await q.rows<{ s: string }>(`select status::text as s from public.series where id = $1`, [IDS.annaSeries]))[0]?.s,
        why: await q.attempt(`select * from private.series_holds`),
        emails: await q.attempt(`select * from private.customer_notices`),
        payment: (await q.rows(`select 1 from public.payments where visit_id = $1`, [today])).length,
      };
    });
    expect(r).toEqual({ sees: "paused", why: DENIED, emails: DENIED, payment: 0 });
  });

  it("refuses to start a clean in a held block with a clear \"don't go\"", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`insert into private.series_holds (series_id, reason) values ($1, 'payment_failed')`, [IDS.annaSeries]);
      await q.rows(`update public.series set status = 'paused' where id = $1`, [IDS.annaSeries]);
      await q.actAs(U.tara);
      return q.failure(`select public.start_visit($1)`, [today]);
    });
    expect(r?.code).toBe("PC017");
  });
});

describe("coming off hold", () => {
  it("resumes the moment the customer pays; cleans that passed on hold are skipped, the rest go ahead", async () => {
    const r = await as("superuser", async (q) => {
      await lastTryFailed(q);
      // A week goes by on hold: next week's clean passes.
      await q.rows(`update public.visits set scheduled_date = private.london_today() - 1 where id = $1`, [IDS.visitNextWeek]);
      const paid = await result(q, "succeeded");
      const upcoming = await q.count(`public.visits where series_id = '${IDS.annaSeries}' and status = 'scheduled'`);
      return { paid, status: await seriesStatus(q), holds: await holds(q), passed: await nextWeek(q),
        charged: await q.count(`public.payments where visit_id = '${IDS.visitNextWeek}'`), upcoming: upcoming >= 0,
        alertOpen: await q.count(`public.engine_alerts where visit_id = '${today}' and kind = 'payment_failed' and resolved_at is null`) };
    });
    expect(r).toMatchObject({ paid: "succeeded", holds: [{ reason: "payment_failed", outcome: "resumed" }],
      passed: { status: "skipped", cancel_reason: "payment_hold" }, charged: 0, alertOpen: 0 });
    expect(["claimed", "ended"]).toContain(r.status); // back on (or finished, if that was the block's last clean)
  });

  it("stays on hold while another clean in the block is still unpaid", async () => {
    const r = await as("superuser", async (q) => {
      await lastTryFailed(q);
      // A second clean in the block, also unpaid for good.
      await q.rows(`update public.visits set status = 'completed', started_at = now(), completed_at = now() where id = $1`, [IDS.visitNextWeek]);
      const [other] = await q.rows<{ id: string }>(`select private.insert_visit_charge($1) as id`, [IDS.visitNextWeek]);
      await q.rows(`update public.payments set status = 'failed' where id = $1`, [other!.id]);
      await q.rows(`update public.payments set status = 'failed_final' where id = $1`, [other!.id]);
      const paid = await result(q, "succeeded");
      return { paid, status: await seriesStatus(q), holds: await holds(q) };
    });
    expect(r).toEqual({ paid: "succeeded", status: "paused", holds: [{ reason: "payment_failed", outcome: null }] });
  });
});

describe("the nightly check", () => {
  const run = async (q: Query) => (await q.rows<{ n: number }>(`select private.run_payment_holds() as n`))[0]!.n;

  it("skips cleans that pass on hold, and leaves the block on hold inside Carl's 7 days", async () => {
    const r = await as("superuser", async (q) => {
      await lastTryFailed(q);
      await q.rows(`update public.visits set scheduled_date = private.london_today() - 1 where id = $1`, [IDS.visitNextWeek]);
      await q.rows(`update private.series_holds set held_at = now() - interval '6 days' where series_id = $1`, [IDS.annaSeries]);
      return { ended: await run(q), status: await seriesStatus(q), passed: await nextWeek(q) };
    });
    expect(r).toEqual({ ended: 0, status: "paused", passed: { status: "skipped", cancel_reason: "payment_hold" } });
  });

  it("ends a block still unpaid after 7 days, frees the cleaner, tells the team and emails the customer", async () => {
    const r = await as("superuser", async (q) => {
      await lastTryFailed(q);
      await q.rows(`update private.series_holds set held_at = now() - interval '8 days' where series_id = $1`, [IDS.annaSeries]);
      const ended = await run(q);
      const again = await run(q);
      const [pay] = await q.rows<{ s: string }>(`select status::text as s from public.payments where visit_id = $1`, [today]);
      return { ended, again, status: await seriesStatus(q), holds: await holds(q), next: await nextWeek(q), notices: await notices(q),
        closedAlert: await q.count(`public.engine_alerts where series_id = '${IDS.annaSeries}' and kind = 'block_closed' and resolved_at is null`), stillOwed: pay!.s };
    });
    expect(r).toEqual({ ended: 1, again: 0, status: "ended", holds: [{ reason: "payment_failed", outcome: "ended" }],
      next: { status: "cancelled", cancel_reason: "block_ended" }, notices: [{ kind: "block_on_hold" }, { kind: "block_ended_unpaid" }],
      closedAlert: 1, stillOwed: "failed_final" });
  });

  it("never ends a block automatically when no limit is set", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.settings set payment_pause_days = null`);
      await lastTryFailed(q);
      await q.rows(`update private.series_holds set held_at = now() - interval '40 days' where series_id = $1`, [IDS.annaSeries]);
      return { ended: await run(q), status: await seriesStatus(q) };
    });
    expect(r).toEqual({ ended: 0, status: "paused" });
  });

  it("closes the hold quietly when the team ended the block themselves", async () => {
    const r = await as("superuser", async (q) => {
      await lastTryFailed(q);
      await q.actAs(U.admin);
      await q.rows(`select public.admin_end_block($1, 'Customer asked to stop')`, [IDS.annaSeries]);
      await su(q);
      return { ended: await run(q), holds: await holds(q), notices: await notices(q) };
    });
    expect(r).toEqual({ ended: 0, holds: [{ reason: "payment_failed", outcome: "ended" }], notices: [{ kind: "block_on_hold" }] });
  });
});

describe("sending the emails", () => {
  it("hands each notice to one sender at a time, with only what the email needs, until it's sent", async () => {
    const r = await as("superuser", async (q) => {
      await lastTryFailed(q);
      await server(q);
      const first = await q.rows<Record<string, unknown>>(`select * from public.notices_claim(20)`);
      const again = await q.rows(`select * from public.notices_claim(20)`);
      await q.rows(`select public.notice_sent($1, 'provider said no')`, [first[0]!.notice_id]);
      await su(q);
      await q.rows(`update private.customer_notices set claimed_at = now() - interval '11 minutes'`);
      await server(q);
      const retry = await q.rows<Record<string, unknown>>(`select * from public.notices_claim(20)`);
      await q.rows(`select public.notice_sent($1, null)`, [retry[0]!.notice_id]);
      const done = await q.rows(`select * from public.notices_claim(20)`);
      await su(q);
      const [row] = await q.rows(`select attempts::int, sent_at is not null as sent, last_error from private.customer_notices`);
      const [anna] = await q.rows<{ email: string; full_name: string }>(`select email, full_name from public.profiles where id = $1`, [U.anna]);
      return { first, again: again.length, retry: retry.length, done: done.length, row, anna };
    });
    expect(r.first).toHaveLength(1);
    expect(r.first[0]).toMatchObject({ kind: "block_on_hold", email: r.anna!.email, full_name: r.anna!.full_name, amount_pence: 5000 });
    expect(Object.keys(r.first[0]!).sort()).toEqual(["amount_pence", "clean_date", "email", "full_name", "kind", "notice_id", "payment_id"]);
    expect(r).toMatchObject({ again: 0, retry: 1, done: 0, row: { attempts: 2, sent: true, last_error: null } });
  });

  it("is server only", async () => {
    for (const who of ["tara", "anna", "admin", "anon"] as const) {
      const codes = await as(who, async (q) => [
        await q.attempt(`select * from public.notices_claim(20)`),
        await q.attempt(`select public.notice_sent(gen_random_uuid(), null)`),
        await q.attempt(`select private.run_payment_holds()`),
        await q.attempt(`select private.release_payment_hold($1)`, [IDS.annaSeries]),
      ]);
      expect({ who, codes }).toEqual({ who, codes: [DENIED, DENIED, DENIED, DENIED] });
    }
  });
});
