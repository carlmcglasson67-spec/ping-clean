// Payments PR 8: the customer presses "Pay now". Only their own payment, only when it's
// waiting on them, and the amount, card and cleaner all come from the database.
import { afterAll, describe, expect, it } from "vitest";
import { as, DENIED, IDS, pool, U, type Query } from "./helpers";

afterAll(() => pool.end());

const today = IDS.visitToday;
const PI = "pi_TestPayNow0001";
const su = (q: Query) => q.rows(`reset role`);
const server = async (q: Query) => { await q.rows(`reset role`); await q.rows(`set local role service_role`); };

/** Anna's clean today is done and its charge has been sent once by the job. */
async function chargeSent(q: Query, opts: { card?: boolean } = {}) {
  if (opts.card ?? true) await q.rows(`insert into private.customer_billing (customer_id, stripe_customer_id, default_payment_method_id) values ($1, 'cus_TestAnna0001', 'pm_TestAnna0001')`, [U.anna]);
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
const pay = async (q: Query) => (await q.rows<{ id: string; status: string; attempts: number; amount_pence: number; application_fee_pence: number; cleaner_account_id: string }>(
  `select id, status::text, attempts::int, amount_pence, application_fee_pence, cleaner_account_id from public.payments where visit_id = $1 and kind = 'visit'`, [today]))[0]!;
async function result(q: Query, outcome: string) {
  const p = await pay(q);
  await server(q);
  await q.rows(`select public.stripe_payment_result($1, $2, $3, $4, $5, $6, null, $7, null)`,
    [p.id, PI, outcome, p.amount_pence, p.application_fee_pence, p.cleaner_account_id, outcome === "failed" ? "card_declined" : null]);
  await su(q);
}
async function begin(q: Query, who: string = U.anna) {
  const p = await pay(q);
  await server(q);
  const r = await q.rows<Record<string, unknown>>(`select * from public.customer_pay_begin($1, $2)`, [p.id, who]);
  await su(q);
  return r;
}

describe("pay now", () => {
  it("takes a failed payment for one more try, with the customer's card and the cleaner fixed by the database", async () => {
    const r = await as("superuser", async (q) => {
      await chargeSent(q);
      await result(q, "failed");
      const before = await pay(q);
      const got = await begin(q);
      return { before, got, after: await pay(q), twice: (await begin(q))[0]!.problem };
    });
    expect(r.got).toEqual([{ problem: null, payment_id: r.before.id, mode: "retry", visit_id: today, amount_pence: r.before.amount_pence,
      application_fee_pence: r.before.application_fee_pence, stripe_customer_id: "cus_TestAnna0001", payment_method_id: "pm_TestAnna0001",
      cleaner_account_id: r.before.cleaner_account_id, payment_intent_id: PI, attempt: 101, idempotency_key: `payment:${r.before.id}` }]);
    expect(r.after).toMatchObject({ status: "processing", attempts: 1 }); // her own try isn't one of the automatic ones
    expect(r.twice).toBe("in_progress"); // a second press while the first is out does nothing
  });

  it("works when the bank wants them to confirm, and after every automatic try has failed", async () => {
    const r = await as("superuser", async (q) => {
      await chargeSent(q);
      await result(q, "requires_action");
      const confirm = (await begin(q))[0]!.problem;
      await result(q, "failed");
      await q.rows(`update public.settings set payment_retry_hours = null`);
      const again = (await begin(q))[0]!.problem; // failed, with a retry pending
      await result(q, "failed");                  // now failed for good: the block is on hold
      const held = (await q.rows<{ s: string }>(`select status::text as s from public.series where id = $1`, [IDS.annaSeries]))[0]!.s;
      const final = (await begin(q))[0]!.problem;
      await result(q, "succeeded");
      const resumed = (await q.rows<{ s: string }>(`select status::text as s from public.series where id = $1`, [IDS.annaSeries]))[0]!.s;
      return { confirm, again, held, final, resumed, paid: (await begin(q))[0]!.problem, status: (await pay(q)).status };
    });
    expect(r).toEqual({ confirm: null, again: null, held: "paused", final: null, resumed: "claimed", paid: "already_paid", status: "succeeded" });
  });

  it("a decline on her own try keeps the automatic schedule: still due at 72 hours, block not on hold", async () => {
    const r = await as("superuser", async (q) => {
      await chargeSent(q);
      await result(q, "failed");                                  // automatic try 1
      await q.rows(`update public.payments set next_retry_at = now() - interval '1 minute' where visit_id = $1`, [today]);
      await server(q); await q.rows(`select * from public.charge_claim(10)`); await su(q);
      await result(q, "failed");                                  // automatic try 2: next due at 72 hours
      for (let i = 0; i < 3; i++) { await begin(q); await result(q, "failed"); } // she tries three times herself
      const [p] = await q.rows(`select status::text, attempts::int, customer_tries::int, round(extract(epoch from next_retry_at - created_at) / 3600)::int as retry_hours
                                from public.payments where visit_id = $1`, [today]);
      const [s] = await q.rows<{ s: string }>(`select status::text as s from public.series where id = $1`, [IDS.annaSeries]);
      return { p, series: s!.s, emails: await q.count(`private.customer_notices where customer_id = '${U.anna}'`) };
    });
    expect(r).toEqual({ p: { status: "failed", attempts: 2, customer_tries: 3, retry_hours: 72 }, series: "claimed", emails: 2 });
  });

  it("is refused for anyone else's payment, without saying whether it exists", async () => {
    const r = await as("superuser", async (q) => {
      await chargeSent(q);
      await result(q, "failed");
      const ben = (await begin(q, U.ben))[0]!;
      const tara = (await begin(q, U.tara))[0]!;
      await server(q);
      const [nothing] = await q.rows<{ problem: string }>(`select problem from public.customer_pay_begin(gen_random_uuid(), $1)`, [U.anna]);
      const intent = await q.rows<{ i: string | null }>(`select public.customer_payment_intent($1, $2) as i`, [(ben.payment_id as string) ?? IDS.visitDone, U.ben]);
      await su(q);
      const p = await pay(q);
      await server(q);
      const [mine] = await q.rows<{ i: string; s: string }>(`select public.customer_payment_intent($1, $2) as i, public.customer_card_series($1, $2) as s`, [p.id, U.anna]);
      const [theirs] = await q.rows<{ i: string | null; s: string | null }>(`select public.customer_payment_intent($1, $2) as i, public.customer_card_series($1, $2) as s`, [p.id, U.ben]);
      await su(q);
      return { ben: ben.problem, tara: tara.problem, nothing: nothing!.problem, intent: intent[0]!.i, mine, theirs, status: (await pay(q)).status };
    });
    expect(r).toEqual({ ben: "not_found", tara: "not_found", nothing: "not_found", intent: null,
      mine: { i: PI, s: IDS.annaSeries }, theirs: { i: null, s: null }, status: "failed" });
  });

  it("says when there's no card, and when the cleaner's account can't take money", async () => {
    const r = await as("superuser", async (q) => {
      await chargeSent(q, { card: false }); // the job's try failed: no saved card, nothing sent
      const noCard = (await begin(q))[0]!.problem;
      await q.rows(`insert into private.customer_billing (customer_id, stripe_customer_id, default_payment_method_id) values ($1, 'cus_TestAnna0001', 'pm_TestAnna0001')`, [U.anna]);
      await q.rows(`update public.cleaners set stripe_payouts_enabled = false where id = $1`, [U.tara]);
      const notReady = (await begin(q))[0]!.problem;
      await q.rows(`update public.cleaners set stripe_payouts_enabled = true where id = $1`, [U.tara]);
      const ok = (await begin(q))[0]!;
      return { noCard, notReady, ok: [ok.problem, ok.mode, ok.payment_intent_id], attempts: (await pay(q)).attempts };
    });
    expect(r).toEqual({ noCard: "no_card", notReady: "not_ready", ok: [null, "create", null], attempts: 1 });
  });

  it("stops after ten tries", async () => {
    const r = await as("superuser", async (q) => {
      await chargeSent(q);
      await result(q, "failed");
      await q.rows(`update public.payments set customer_tries = 10 where visit_id = $1`, [today]);
      return (await begin(q))[0]!.problem;
    });
    expect(r).toBe("too_many");
  });

  it("is server only: no signed-in role can call it, even for their own payment", async () => {
    for (const who of ["anna", "tara", "admin", "anon"] as const) {
      const codes = await as(who, async (q) => [
        await q.attempt(`select * from public.customer_pay_begin(gen_random_uuid(), $1)`, [U.anna]),
        await q.attempt(`select public.customer_payment_intent(gen_random_uuid(), $1)`, [U.anna]),
        await q.attempt(`select public.customer_card_series(gen_random_uuid(), $1)`, [U.anna]),
      ]);
      expect({ who, codes }).toEqual({ who, codes: [DENIED, DENIED, DENIED] });
    }
  });

  it("the cron kick fires for a waiting email as well as a charge", async () => {
    const r = await as("superuser", async (q) => {
      const idle = (await q.rows<{ d: boolean }>(`select private.charges_due() as d`))[0]!.d;
      await q.rows(`select private.queue_notice('block_ended_unpaid', null, $1, 'test:1')`, [IDS.annaSeries]);
      const waiting = (await q.rows<{ d: boolean }>(`select private.charges_due() as d`))[0]!.d;
      await q.rows(`update private.customer_notices set sent_at = now()`);
      return { idle, waiting, sent: (await q.rows<{ d: boolean }>(`select private.charges_due() as d`))[0]!.d };
    });
    expect(r).toEqual({ idle: false, waiting: true, sent: false });
  });
});
