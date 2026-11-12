// Payments PR 6: charging a clean once it's complete. The "to charge" row, the job's claim,
// what Stripe said (job and webhook), retries, and who may call what.
import { afterAll, describe, expect, it } from "vitest";
import { as, DENIED, IDS, pool, U, type Query } from "./helpers";

afterAll(() => pool.end());

const today = IDS.visitToday; // Anna's clean today, Tara's (seed)
const CUS = "cus_TestAnna0001";
const CARD = "pm_TestAnna0001";
const PI = "pi_TestCharge0001";

const su = (q: Query) => q.rows(`reset role`);
const server = async (q: Query) => { await q.rows(`reset role`); await q.rows(`set local role service_role`); };

/** Anna has a saved card; Tara does today's clean and marks it complete. */
async function cleanDone(q: Query, opts: { card?: boolean; couldntDo?: boolean } = {}) {
  if (opts.card ?? true) {
    await q.rows(`insert into private.customer_billing (customer_id, stripe_customer_id, default_payment_method_id) values ($1, $2, $3)`, [U.anna, CUS, CARD]);
    await q.rows(`insert into public.series_billing (series_id, stripe_payment_method_id) values ($1, $2)
                  on conflict (series_id) do update set stripe_payment_method_id = excluded.stripe_payment_method_id`, [IDS.annaSeries, CARD]);
  }
  await q.actAs(U.tara);
  await q.rows(`select public.start_visit($1)`, [today]);
  await q.rows(`update public.checklist_items set done = true where visit_id = $1 and item_key <> 'bins.empty'`, [today]);
  if (opts.couldntDo) await q.rows(`update public.checklist_items set skipped_reason = 'Bins already collected' where visit_id = $1 and item_key = 'bins.empty'`, [today]);
  else await q.rows(`update public.checklist_items set done = true where visit_id = $1 and item_key = 'bins.empty'`, [today]);
  for (const kind of ["before", "after"]) {
    await q.rows(`insert into storage.objects (bucket_id, name, owner, metadata) values ('visit-photos', $1, auth.uid(), '{"size": 184000}')`, [`${today}/${kind}.jpg`]);
    await q.rows(`insert into public.visit_photos (visit_id, kind, storage_path, uploaded_by) values ($1, $2, $3, $4)`, [today, kind, `${today}/${kind}.jpg`, U.tara]);
  }
  await q.rows(`select public.complete_visit($1)`, [today]);
  await su(q);
}

type Pay = { id: string; status: string; attempts: number; amount_pence: number; application_fee_pence: number; cleaner_amount_pence: number;
  idempotency_key: string; stripe_payment_intent_id: string | null; stripe_charge_id: string | null; cleaner_account_id: string | null;
  last_error_code: string | null; retry_hours: number | null };
const payment = async (q: Query) => (await q.rows<Pay>(
  `select id, status::text, attempts::int, amount_pence, application_fee_pence, cleaner_amount_pence, idempotency_key, stripe_payment_intent_id,
          stripe_charge_id, cleaner_account_id, last_error_code,
          round(extract(epoch from next_retry_at - created_at) / 3600)::int as retry_hours
   from public.payments where visit_id = $1 and kind = 'visit' order by created_at desc limit 1`, [today]))[0];
const alerts = async (q: Query) => (await q.rows<{ kind: string; open: boolean }>(
  `select kind, resolved_at is null as open from public.engine_alerts where visit_id = $1 order by kind`, [today]));
const claim = async (q: Query) => { await server(q); const r = await q.rows<Record<string, unknown>>(`select * from public.charge_claim(10)`); await su(q); return r; };
const taraAccount = async (q: Query) => (await q.rows<{ a: string }>(`select stripe_account_id as a from public.cleaners where id = $1`, [U.tara]))[0]!.a;

/** What Stripe said, as the job or webhook reports it. Defaults match the row. */
async function result(q: Query, outcome: string, over: { intent?: string; amount?: number; fee?: number; destination?: string; error?: string; at?: string | null } = {}) {
  const p = (await payment(q))!;
  await server(q);
  const r = await q.rows<{ r: string }>(`select public.stripe_payment_result($1, $2, $3, $4, $5, $6, $7, $8, $9) as r`,
    [p.id, over.intent ?? PI, outcome, over.amount ?? p.amount_pence, over.fee ?? p.application_fee_pence,
     over.destination ?? p.cleaner_account_id, outcome === "succeeded" ? "ch_TestCharge0001" : null, over.error ?? null, over.at ?? null]);
  await su(q);
  return r[0]!.r;
}
const due = (q: Query) => q.rows(`update public.payments set next_retry_at = now() - interval '1 minute' where visit_id = $1 and status = 'failed'`, [today]);

describe("completing a clean queues its charge", () => {
  it("writes one pending payment with the clean's own three amounts, in the same step", async () => {
    const r = await as("superuser", async (q) => {
      await cleanDone(q);
      const [v] = await q.rows(`select price_pence, cleaner_earnings_pence, ping_fee_pence from public.visits where id = $1`, [today]);
      const p = (await payment(q))!;
      await q.actAs(U.tara);
      await q.rows(`select public.complete_visit($1)`, [today]); // tapped again
      await su(q);
      const [audit] = await q.rows<{ actor_id: string }>(`select actor_id from public.audit_log where entity = 'payments' and entity_id = $1`, [p.id]);
      return { v, p, rows: await q.count(`public.payments where visit_id = '${today}'`), key: p.idempotency_key === `payment:${p.id}`, actor: audit?.actor_id, alerts: await alerts(q) };
    });
    expect(r.p).toMatchObject({ status: "pending", attempts: 0, amount_pence: r.v!.price_pence, cleaner_amount_pence: r.v!.cleaner_earnings_pence,
      application_fee_pence: r.v!.ping_fee_pence, stripe_payment_intent_id: null });
    expect(r).toMatchObject({ rows: 1, key: true, actor: U.tara, alerts: [] });
  });

  it("holds the charge for the Ping team when there were \"couldn't do\" items and no rule is set", async () => {
    const r = await as("superuser", async (q) => {
      await cleanDone(q, { couldntDo: true });
      const held = { payments: await q.count(`public.payments where visit_id = '${today}'`), alerts: await alerts(q) };
      await q.actAs(U.tara);
      const cleaner = await q.attempt(`select public.admin_charge_visit($1)`, [today]);
      await q.actAs(U.anna);
      const customer = await q.attempt(`select public.admin_charge_visit($1)`, [today]);
      await q.actAs(U.admin);
      const notDone = await q.attempt(`select public.admin_charge_visit($1)`, [IDS.visitNextWeek]);
      const charged = await q.attempt(`select public.admin_charge_visit($1)`, [today]);
      const twice = await q.attempt(`select public.admin_charge_visit($1)`, [today]);
      await su(q);
      return { held, cleaner, customer, notDone, charged, twice, p: (await payment(q))!.status, alerts: await alerts(q) };
    });
    expect(r).toEqual({
      held: { payments: 0, alerts: [{ kind: "charge_held", open: true }] },
      cleaner: DENIED, customer: DENIED, notDone: "PC050", charged: "ok", twice: "PC051",
      p: "pending", alerts: [{ kind: "charge_held", open: false }],
    });
  });

  it("charges as normal with \"couldn't do\" items once Carl's rule says charge in full", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.settings set couldnt_do_rule = 'charge_full'`);
      await cleanDone(q, { couldntDo: true });
      return { p: (await payment(q))?.status, alerts: await alerts(q) };
    });
    expect(r).toEqual({ p: "pending", alerts: [] });
  });

  it("writes nothing for a clean with nothing to pay", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.visits set price_pence = 0, cleaner_earnings_pence = 0, ping_fee_pence = 0 where id = $1`, [today]);
      await cleanDone(q);
      return q.count(`public.payments where visit_id = '${today}'`);
    });
    expect(r).toBe(0);
  });
});

describe("the job takes what's due", () => {
  it("claims a charge once, with the customer's card and the cleaner who did the clean", async () => {
    const r = await as("superuser", async (q) => {
      await cleanDone(q);
      const first = await claim(q);
      const p = (await payment(q))!;
      const again = await claim(q); // a second run a moment later
      return { first, p, again: again.length, tara: await taraAccount(q) };
    });
    expect(r.first).toEqual([{ payment_id: r.p.id, mode: "create", visit_id: today, amount_pence: r.p.amount_pence,
      application_fee_pence: r.p.application_fee_pence, stripe_customer_id: CUS, payment_method_id: CARD, cleaner_account_id: r.tara,
      payment_intent_id: null, attempt: 1, idempotency_key: `payment:${r.p.id}` }]);
    expect(r.p).toMatchObject({ status: "processing", attempts: 1, cleaner_account_id: r.tara });
    expect(r.again).toBe(0);
  });

  it("picks a try up again after 10 minutes without an answer: sent again if Stripe never got it, checked if it did", async () => {
    const r = await as("superuser", async (q) => {
      await cleanDone(q);
      await claim(q);
      await q.rows(`update public.payments set charge_started_at = now() - interval '11 minutes' where visit_id = $1`, [today]);
      const resent = await claim(q);
      const attempts = (await payment(q))!.attempts;
      await q.rows(`update public.payments set charge_started_at = now() - interval '11 minutes', stripe_payment_intent_id = $2 where visit_id = $1`, [today, PI]);
      const checked = await claim(q);
      return { resent: resent.map((x) => [x.mode, x.attempt]), attempts, checked: checked.map((x) => [x.mode, x.payment_intent_id, x.payment_method_id]) };
    });
    expect(r).toEqual({ resent: [["create", 1]], attempts: 1, checked: [["check", PI, null]] });
  });

  it("flags a try stuck for a day instead of sending it again (Stripe has forgotten the key)", async () => {
    const r = await as("superuser", async (q) => {
      await cleanDone(q);
      await claim(q);
      await q.rows(`update public.payments set charge_started_at = now() - interval '25 hours' where visit_id = $1`, [today]);
      return { claimed: (await claim(q)).length, alerts: await alerts(q) };
    });
    expect(r).toEqual({ claimed: 0, alerts: [{ kind: "charge_blocked", open: true }] });
  });

  it("with no saved card, counts a failed try and comes back on Carl's schedule", async () => {
    const r = await as("superuser", async (q) => {
      await cleanDone(q, { card: false });
      return { claimed: (await claim(q)).length, p: await payment(q) };
    });
    expect(r.claimed).toBe(0);
    expect(r.p).toMatchObject({ status: "failed", attempts: 1, last_error_code: "no_saved_card", retry_hours: 24 });
  });

  it("when the cleaner's Stripe account can't take money, waits and tells the team; the customer loses no tries", async () => {
    const r = await as("superuser", async (q) => {
      await cleanDone(q);
      await q.rows(`update public.cleaners set stripe_charges_enabled = false where id = $1`, [U.tara]);
      const blocked = (await claim(q)).length;
      const p = (await payment(q))!;
      const waiting = (await claim(q)).length; // not asked again until the hour is up
      await q.rows(`update public.cleaners set stripe_charges_enabled = true where id = $1`, [U.tara]);
      await q.rows(`update public.payments set next_retry_at = now() - interval '1 minute' where id = $1`, [p.id]);
      const after = await claim(q);
      return { blocked, p: [p.status, p.attempts, p.retry_hours], waiting, alerts: await alerts(q), after: after.map((x) => [x.mode, x.attempt]) };
    });
    expect(r).toEqual({ blocked: 0, p: ["pending", 0, 1], waiting: 0, alerts: [{ kind: "charge_blocked", open: true }], after: [["create", 1]] });
  });
});

describe("what Stripe said", () => {
  it("records a success once, and nothing moves it back", async () => {
    const r = await as("superuser", async (q) => {
      await cleanDone(q);
      await claim(q);
      const first = await result(q, "succeeded");
      const p = (await payment(q))!;
      return { first, p, replay: await result(q, "succeeded"), lateFailure: await result(q, "failed", { error: "card_declined" }),
               lateAuth: await result(q, "requires_action"), status: (await payment(q))!.status };
    });
    expect(r).toMatchObject({ first: "succeeded", replay: "already", lateFailure: "ignored", lateAuth: "ignored", status: "succeeded" });
    expect(r.p).toMatchObject({ status: "succeeded", stripe_payment_intent_id: PI, stripe_charge_id: "ch_TestCharge0001", last_error_code: null });
  });

  it("refuses an answer that isn't this row's: another PaymentIntent, amount, fee or cleaner", async () => {
    const r = await as("superuser", async (q) => {
      await cleanDone(q);
      await claim(q);
      const p = (await payment(q))!;
      const out = {
        amount: await result(q, "succeeded", { amount: p.amount_pence - 1 }),
        fee: await result(q, "succeeded", { fee: p.application_fee_pence + 1 }),
        destination: await result(q, "succeeded", { destination: "acct_SomeoneElse01" }),
        status: (await payment(q))!.status,
        alerts: await alerts(q),
      };
      await result(q, "processing"); // the real one is now known
      return { ...out, otherIntent: await result(q, "succeeded", { intent: "pi_TestOther00001" }), after: (await payment(q))!.status };
    });
    expect(r).toEqual({ amount: "mismatch", fee: "mismatch", destination: "mismatch", status: "processing",
      alerts: [{ kind: "charge_blocked", open: true }], otherIntent: "mismatch", after: "processing" });
  });

  it("an answer for a charge the job never sent, or an unknown payment, changes nothing", async () => {
    const r = await as("superuser", async (q) => {
      await cleanDone(q);
      const unsent = await result(q, "succeeded", { destination: await taraAccount(q) }); // still pending: no destination fixed yet
      await server(q);
      const [unknown] = await q.rows<{ r: string }>(`select public.stripe_payment_result(gen_random_uuid(), $1, 'succeeded', 5000, 1250, 'acct_TestTara0001', null, null, null) as r`, [PI]);
      const bad = await q.attempt(`select public.stripe_payment_result(gen_random_uuid(), $1, 'refunded', 5000, 1250, 'acct_TestTara0001', null, null, null)`, [PI]);
      await su(q);
      return { unsent, unknown: unknown!.r, bad, status: (await payment(q))!.status };
    });
    expect(r).toEqual({ unsent: "mismatch", unknown: "unknown", bad: "22023", status: "pending" });
  });

  it("retries a failed charge 24 and 72 hours after it was first due, confirming the same PaymentIntent, then stops and tells the team", async () => {
    const r = await as("superuser", async (q) => {
      await cleanDone(q);
      await claim(q);
      const one = await result(q, "failed", { error: "insufficient_funds" });
      const afterOne = (await payment(q))!;
      const tooSoon = (await claim(q)).length;
      await due(q);
      const second = await claim(q);
      await result(q, "failed", { error: "insufficient_funds" });
      const afterTwo = (await payment(q))!;
      await due(q);
      const third = await claim(q);
      const last = await result(q, "failed", { error: "card_declined" });
      const final = (await payment(q))!;
      return { one, afterOne: [afterOne.status, afterOne.attempts, afterOne.retry_hours, afterOne.last_error_code], tooSoon,
        second: second.map((x) => [x.mode, x.attempt, x.payment_intent_id]), afterTwo: [afterTwo.status, afterTwo.attempts, afterTwo.retry_hours],
        third: third.map((x) => [x.mode, x.attempt]), last, final: [final.status, final.attempts, final.retry_hours, final.last_error_code],
        alerts: await alerts(q), more: (await claim(q)).length };
    });
    expect(r).toEqual({
      one: "failed", afterOne: ["failed", 1, 24, "insufficient_funds"], tooSoon: 0,
      second: [["retry", 2, PI]], afterTwo: ["failed", 2, 72],
      third: [["retry", 3]], last: "failed", final: ["failed_final", 3, null, "card_declined"],
      alerts: [{ kind: "payment_failed", open: true }], more: 0,
    });
  });

  it("with no retry schedule set, a failed charge goes straight to the team", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.settings set payment_retry_hours = null`);
      await cleanDone(q);
      await claim(q);
      await result(q, "failed", { error: "card_declined" });
      return { status: (await payment(q))!.status, alerts: await alerts(q) };
    });
    expect(r).toEqual({ status: "failed_final", alerts: [{ kind: "payment_failed", open: true }] });
  });

  it("records money that arrives after Ping had given up, and settles the alert", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.settings set payment_retry_hours = null`);
      await cleanDone(q);
      await claim(q);
      await result(q, "failed", { error: "card_declined" });
      return { late: await result(q, "succeeded"), status: (await payment(q))!.status, alerts: await alerts(q) };
    });
    expect(r).toEqual({ late: "succeeded", status: "succeeded", alerts: [{ kind: "payment_failed", open: false }] });
  });

  it("waits for the customer when their bank wants them to confirm, and settles when they have", async () => {
    const r = await as("superuser", async (q) => {
      await cleanDone(q);
      await claim(q);
      const asked = await result(q, "requires_action");
      const waiting = { status: (await payment(q))!.status, alerts: await alerts(q), claimed: (await claim(q)).length };
      return { asked, waiting, confirmed: await result(q, "succeeded"), status: (await payment(q))!.status, alerts: await alerts(q) };
    });
    expect(r).toEqual({ asked: "requires_action",
      waiting: { status: "requires_action", alerts: [{ kind: "payment_needs_customer", open: true }], claimed: 0 },
      confirmed: "succeeded", status: "succeeded", alerts: [{ kind: "payment_needs_customer", open: false }] });
  });

  it("ignores bad news about an older try once a newer one has been sent", async () => {
    const r = await as("superuser", async (q) => {
      await cleanDone(q);
      await claim(q);
      await result(q, "failed", { error: "insufficient_funds" });
      await due(q);
      await claim(q); // the second try is out
      const old = await result(q, "failed", { error: "insufficient_funds", at: new Date(Date.now() - 3_600_000).toISOString() });
      const status = (await payment(q))!.status;
      const current = await result(q, "failed", { error: "insufficient_funds", at: new Date(Date.now() + 5_000).toISOString() });
      return { old, status, current, after: (await payment(q))!.status };
    });
    expect(r).toEqual({ old: "ignored", status: "processing", current: "failed", after: "failed" });
  });

  it("a request Stripe refused outright is a failed try, once", async () => {
    const r = await as("superuser", async (q) => {
      await cleanDone(q);
      await claim(q);
      const id = (await payment(q))!.id;
      await server(q);
      const [first] = await q.rows<{ r: string }>(`select public.charge_not_sent($1, 'stripe_account_invalid') as r`, [id]);
      const [again] = await q.rows<{ r: string }>(`select public.charge_not_sent($1, 'stripe_account_invalid') as r`, [id]);
      await su(q);
      const p = (await payment(q))!;
      return { first: first!.r, again: again!.r, p: [p.status, p.attempts, p.last_error_code] };
    });
    expect(r).toEqual({ first: "failed", again: "ignored", p: ["failed", 1, "stripe_account_invalid"] });
  });
});

describe("who may do what", () => {
  it("only the server can claim charges or report what Stripe said", async () => {
    for (const who of ["tara", "anna", "admin", "anon"] as const) {
      const codes = await as(who, async (q) => [
        await q.attempt(`select * from public.charge_claim(10)`),
        await q.attempt(`select public.charge_not_sent(gen_random_uuid(), 'x')`),
        await q.attempt(`select public.stripe_payment_result(gen_random_uuid(), 'pi_TestCharge0001', 'succeeded', 1, 0, 'acct_TestTara0001', null, null, null)`),
        await q.attempt(`select private.kick_charge_job()`),
        await q.attempt(`select private.insert_visit_charge($1)`, [IDS.visitDone]),
      ]);
      expect({ who, codes }).toEqual({ who, codes: [DENIED, DENIED, DENIED, DENIED, DENIED] });
    }
  });

  it("customers still see their payment's state, never when a try was sent or any Stripe id", async () => {
    const r = await as("superuser", async (q) => {
      await cleanDone(q);
      await claim(q);
      await q.actAs(U.anna);
      return {
        mine: (await q.rows(`select status::text from public.payments where visit_id = $1`, [today])).length,
        started: await q.attempt(`select charge_started_at from public.payments`),
        account: await q.attempt(`select cleaner_account_id from public.payments`),
      };
    });
    expect(r).toEqual({ mine: 1, started: DENIED, account: DENIED });
  });

  it("the cron kick does nothing when nothing is due, or when the job address isn't set up", async () => {
    const r = await as("superuser", async (q) => {
      const idle = (await q.rows<{ r: string }>(`select private.kick_charge_job() as r`))[0]!.r;
      await cleanDone(q);
      return { idle, due: (await q.rows<{ r: string }>(`select private.kick_charge_job() as r`))[0]!.r };
    });
    expect(r).toEqual({ idle: "nothing_due", due: "not_set_up" });
  });
});
