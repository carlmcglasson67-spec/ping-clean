// Payments PR 2: the money schema. Carl's settings, who can read what, the state machines,
// and that pence always add up. No Stripe calls here (those come in PR 3 onwards).
import { afterAll, describe, expect, it } from "vitest";
import { as, CHECK, DENIED, IDS, pool, setupThen, U, type Query } from "./helpers";

afterAll(() => pool.end());

const SEED_PAYMENT = "00000000-0000-4000-f000-000000000001";
const ROLES = ["anon", "anna", "ben", "tara", "alex", "sam", "admin"] as const;
const asWho = <T>(who: (typeof ROLES)[number], setup: (su: Query) => Promise<void>, fn: (q: Query) => Promise<T>) =>
  setupThen(setup, who === "anon" ? null : U[who], async (q) => {
    if (who === "anon") await q.rows(`set local role anon`);
    return fn(q);
  });

describe("Carl's money settings (8 Nov 2026)", () => {
  it("sets his numbers and leaves every undecided one empty", async () => {
    // Read straight from the migration's result, before the seed's test placeholders: the
    // seed overwrites some columns, so check the ones it doesn't touch, and the migration text.
    const [s] = await as("superuser", (q) => q.rows(
      `select late_cancel_split, payment_retry_hours, failed_payment_pauses_block, couldnt_do_rule, no_access_rule,
              card_expiry_notice_days, late_cancel_when_unclaimed from public.settings`));
    expect(s).toEqual({
      late_cancel_split: "same_as_clean", payment_retry_hours: [24, 72], failed_payment_pauses_block: true,
      couldnt_do_rule: null, no_access_rule: null, card_expiry_notice_days: null, late_cancel_when_unclaimed: null,
    });
    const fs = await import("node:fs");
    const sql = fs.readFileSync(new URL("../../supabase/migrations/20261108100100_money_schema.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/dispute_window_hours = 72,/);
    expect(sql).toMatch(/cancel_notice_hours = 24,/);
    expect(sql).not.toMatch(/late_cancel_fee_pence\s*=/); // the fee stays unset
    expect(sql).toMatch(/Carl's decisions, 8 Nov 2026/);
  });

  it("refuses a fixed cleaner share without a figure, and nonsense retry schedules", async () => {
    for (const sql of [
      `update public.settings set late_cancel_split = 'fixed_share', late_cancel_cleaner_share_bps = null`,
      `update public.settings set payment_retry_hours = '{}'`,
      `update public.settings set payment_retry_hours = '{0}'`,
      `update public.settings set payment_retry_hours = '{24,9999}'`,
      `update public.settings set couldnt_do_rule = 'whatever'`,
    ]) expect({ sql, code: await as("superuser", (q) => q.attempt(sql)) }).toEqual({ sql, code: CHECK });
  });

  it("lets only an admin change them", async () => {
    expect(await as("admin", (q) => q.attempt(`update public.settings set payment_retry_hours = '{12}'`))).toBe("ok");
    for (const who of ["anna", "tara"] as const) {
      expect(await as(who, (q) => q.attempt(`update public.settings set payment_retry_hours = '{12}'`))).toBe("no-rows");
    }
  });
});

describe("saved cards (private.customer_billing)", () => {
  const card = async (su: Query) => {
    await su.rows(`insert into private.customer_billing (customer_id, stripe_customer_id, default_payment_method_id, card_brand, card_last4, card_exp_month, card_exp_year)
                   values ($1, 'cus_TestAnna01', 'pm_TestAnna01', 'visa', '4242', 12, 2030)`, [U.anna]);
  };

  it("is out of reach of every role directly", async () => {
    for (const who of ROLES) {
      const r = await asWho(who, card, async (q) => ({
        read: await q.attempt(`select * from private.customer_billing`),
        write: await q.attempt(`update private.customer_billing set card_last4 = '0000'`),
      }));
      expect({ who, ...r }).toEqual({ who, read: DENIED, write: DENIED });
    }
  });

  it("shows a customer only their own card's brand, last four and expiry", async () => {
    const anna = await asWho("anna", card, (q) => q.rows(`select * from public.my_saved_card()`));
    expect(anna).toEqual([{ brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 }]);
    for (const who of ["ben", "tara", "admin"] as const) {
      expect({ who, rows: await asWho(who, card, (q) => q.rows(`select * from public.my_saved_card()`)) }).toEqual({ who, rows: [] });
    }
    expect(await asWho("anon", card, (q) => q.attempt(`select * from public.my_saved_card()`))).toBe(DENIED);
  });

  it("logs a changed card without storing the ids or digits", async () => {
    const [row] = await as("superuser", async (q) => {
      await card(q);
      await q.rows(`update private.customer_billing set default_payment_method_id = 'pm_TestAnna02', card_last4 = '1881' where customer_id = $1`, [U.anna]);
      return q.rows<{ detail: object }>(`select detail from public.audit_log where entity = 'customer_billing' and action = 'update'`);
    });
    expect(row?.detail).toMatchObject({ default_payment_method_id: "changed", card_last4: "changed" });
    expect(JSON.stringify(row)).not.toMatch(/pm_TestAnna|4242|1881/);
  });

  it("no longer keeps a Stripe customer per block", async () => {
    const cols = await as("superuser", (q) => q.rows(
      `select column_name from information_schema.columns where table_name = 'series_billing' and column_name = 'stripe_customer_id'`));
    expect(cols).toEqual([]);
  });
});

describe("cleaners' Stripe status", () => {
  it("can be read by the cleaner but never set by them", async () => {
    const r = await as("tara", async (q) => ({
      read: (await q.rows(`select stripe_charges_enabled, stripe_payouts_enabled from public.cleaners where id = $1`, [U.tara]))[0],
      write: await q.attempt(`update public.cleaners set stripe_payouts_enabled = true where id = $1`, [U.tara]),
    }));
    expect(r).toEqual({ read: { stripe_charges_enabled: false, stripe_payouts_enabled: false }, write: DENIED });
  });

  it("counts a cleaner as payable only with an account that can take charges and pay out", async () => {
    const r = await as("superuser", async (q) => {
      const p = async () => (await q.rows<{ ok: boolean }>(`select private.cleaner_payable($1) as ok`, [U.tara]))[0]!.ok;
      const before = await p();
      await q.rows(`update public.cleaners set stripe_account_id = 'acct_TestTara01', stripe_charges_enabled = true where id = $1`, [U.tara]);
      const half = await p();
      await q.rows(`update public.cleaners set stripe_payouts_enabled = true where id = $1`, [U.tara]);
      return { before, half, after: await p() };
    });
    expect(r).toEqual({ before: false, half: false, after: true });
    expect(await as("tara", (q) => q.attempt(`select private.cleaner_payable($1)`, [U.tara]))).toBe(DENIED);
  });
});

describe("payments", () => {
  it("must add up: charge = cleaner's part + Ping's fee", async () => {
    expect(await as("superuser", (q) => q.attempt(
      `insert into public.payments (visit_id, customer_id, amount_pence, application_fee_pence, cleaner_amount_pence, idempotency_key)
       values ($1, $2, 5000, 1250, 3700, 'k1')`, [IDS.visitToday, U.anna]))).toBe(CHECK);
  });

  it("shows the customer amounts and states, never Stripe ids or keys; nobody else's", async () => {
    const r = await as("anna", async (q) => ({
      amounts: await q.rows(`select amount_pence, application_fee_pence, cleaner_amount_pence, status from public.payments`),
      pi: await q.attempt(`select stripe_payment_intent_id from public.payments`),
      key: await q.attempt(`select idempotency_key from public.payments`),
      acct: await q.attempt(`select cleaner_account_id from public.payments`),
      write: await q.attempt(`update public.payments set status = 'refunded'`),
    }));
    expect(r).toEqual({ amounts: [{ amount_pence: 5000, application_fee_pence: 1250, cleaner_amount_pence: 3750, status: "succeeded" }],
      pi: DENIED, key: DENIED, acct: DENIED, write: DENIED });
    expect(await as("ben", (q) => q.count("public.payments"))).toBe(0);
  });

  it("only moves along the state map (a replayed webhook can't un-refund a payment)", async () => {
    const run = (moves: string[]) => as("superuser", async (q) => {
      await q.rows(`insert into public.payments (id, visit_id, customer_id, amount_pence, application_fee_pence, cleaner_amount_pence, idempotency_key)
                    values ('00000000-0000-4000-f000-0000000000aa', $1, $2, 5000, 1250, 3750, 'k-map')`, [IDS.visitToday, U.anna]);
      const out: string[] = [];
      for (const m of moves) out.push(await q.attempt(`update public.payments set status = '${m}' where id = '00000000-0000-4000-f000-0000000000aa'`));
      return out;
    });
    expect(await run(["processing", "succeeded", "partially_refunded", "refunded"])).toEqual(["ok", "ok", "ok", "ok"]);
    expect(await run(["processing", "failed", "processing", "requires_action", "succeeded", "disputed", "succeeded"]))
      .toEqual(["ok", "ok", "ok", "ok", "ok", "ok", "ok"]);
    expect(await run(["processing", "failed", "failed_final", "processing"])).toEqual(["ok", "ok", "ok", "ok"]);
    expect(await run(["succeeded"])).toEqual(["PC040"]);                                     // pending → succeeded: never sent
    expect(await run(["processing", "succeeded", "refunded", "succeeded"])).toEqual(["ok", "ok", "ok", "PC040"]);
    expect(await run(["processing", "succeeded", "disputed", "dispute_lost", "succeeded"])).toEqual(["ok", "ok", "ok", "ok", "PC040"]);
  });
});

describe("refunds", () => {
  const refund = (amount: number, cleaner: number, ping: number, key: string, status = "succeeded") =>
    `insert into public.refunds (payment_id, amount_pence, cleaner_part_pence, ping_part_pence, reason, note, idempotency_key, status)
     values ('${SEED_PAYMENT}', ${amount}, ${cleaner}, ${ping}, 'clean_quality', 'Kitchen floor missed', '${key}', '${status}')`;

  it("must add up, and never total more than the payment (failed refunds don't count)", async () => {
    const r = await as("superuser", async (q) => ({
      parts: await q.attempt(refund(1000, 700, 200, "r0")),
      first: await q.attempt(refund(3000, 2250, 750, "r1")),
      failed: await q.attempt(refund(2000, 1500, 500, "r2", "failed")),
      fits: await q.attempt(refund(2000, 1500, 500, "r3")),
      over: await q.attempt(refund(1, 1, 0, "r4")),
    }));
    expect(r).toEqual({ parts: CHECK, first: "ok", failed: "ok", fits: "ok", over: "PC042" });
  });

  it("shows the customer their refunds without the Ping team's note; nobody else sees them or writes them", async () => {
    const setup = async (su: Query) => { await su.rows(refund(1000, 750, 250, "r-vis")); };
    const anna = await asWho("anna", setup, async (q) => ({
      rows: await q.rows(`select amount_pence, cleaner_part_pence, ping_part_pence, reason, status from public.refunds`),
      note: await q.attempt(`select note from public.refunds`),
      write: await q.attempt(refund(1, 1, 0, "r-anna")),
    }));
    expect(anna).toEqual({ rows: [{ amount_pence: 1000, cleaner_part_pence: 750, ping_part_pence: 250, reason: "clean_quality", status: "succeeded" }],
      note: DENIED, write: DENIED });
    for (const who of ["anon", "ben", "tara", "alex", "sam"] as const) {
      const n = await asWho(who, setup, async (q) => (await q.attempt(`select id from public.refunds`)) === "ok" ? q.count("public.refunds") : 0);
      expect({ who, n }).toEqual({ who, n: 0 });
    }
    expect(await asWho("admin", setup, (q) => q.count("public.refunds"))).toBe(1);
  });
});

describe("payouts and payout batches", () => {
  it("only move along the state map, and a hold needs a reason", async () => {
    const run = (moves: [string, string | null][]) => as("superuser", async (q) => {
      await q.rows(`insert into public.payouts (id, visit_id, cleaner_id, amount_pence, available_after, idempotency_key)
                    values ('00000000-0000-4000-f200-0000000000aa', $1, $2, 3750, now() + interval '3 days', 'po-map')`, [IDS.visitToday, U.tara]);
      const out: string[] = [];
      for (const [m, reason] of moves) {
        out.push(await q.attempt(`update public.payouts set status = '${m}', held_reason = ${reason ? `'${reason}'` : "null"},
          stripe_payout_id = case when '${m}' in ('in_batch', 'paid') then 'po_TestBatch01' else stripe_payout_id end,
          paid_at = case when '${m}' = 'paid' then now() end
          where id = '00000000-0000-4000-f200-0000000000aa'`));
      }
      return out;
    });
    expect(await run([["held", null]])).toEqual([CHECK]);
    expect(await run([["held", "Refund being looked at"], ["pending", null], ["in_batch", null], ["paid", null]])).toEqual(["ok", "ok", "ok", "ok"]);
    expect(await run([["in_batch", null], ["failed", null], ["pending", null]])).toEqual(["ok", "ok", "ok"]);
    expect(await run([["paid", null]])).toEqual(["PC041"]);
    expect(await run([["cancelled", null], ["pending", null]])).toEqual(["ok", "PC041"]);
  });

  it("show the cleaner their own earnings and bank payouts, without Stripe ids or keys", async () => {
    const r = await as("tara", async (q) => ({
      payouts: await q.rows(`select amount_pence, status from public.payouts`),
      batches: await q.rows(`select amount_pence, status from public.payout_batches`),
      payoutId: await q.attempt(`select stripe_payout_id from public.payouts`),
      batchId: await q.attempt(`select stripe_payout_id from public.payout_batches`),
      key: await q.attempt(`select idempotency_key from public.payout_batches`),
    }));
    expect(r).toEqual({ payouts: [{ amount_pence: 3750, status: "paid" }], batches: [{ amount_pence: 3750, status: "paid" }],
      payoutId: DENIED, batchId: DENIED, key: DENIED });
    for (const who of ["alex", "anna"] as const) {
      expect({ who, n: await as(who, (q) => q.count("public.payout_batches")) }).toEqual({ who, n: 0 });
    }
  });
});

describe("Stripe events", () => {
  it("are out of reach of every role, and each event can only be recorded once", async () => {
    for (const who of ROLES) {
      expect({ who, code: await asWho(who, async () => {}, (q) => q.attempt(`select * from private.stripe_events`)) })
        .toEqual({ who, code: DENIED });
    }
    const r = await as("superuser", async (q) => ({
      first: await q.attempt(`insert into private.stripe_events (event_id, type) values ('evt_TestReplay01', 'payment_intent.succeeded')`),
      replay: await q.attempt(`insert into private.stripe_events (event_id, type) values ('evt_TestReplay01', 'payment_intent.succeeded')`),
      junk: await q.attempt(`insert into private.stripe_events (event_id, type) values ('not-an-event', 'x')`),
    }));
    expect(r).toEqual({ first: "ok", replay: "23505", junk: CHECK });
  });
});

describe("visits: why a clean was cancelled", () => {
  it("takes only the known reasons", async () => {
    const r = await as("superuser", async (q) => ({
      ok: await q.attempt(`update public.visits set status = 'cancelled', cancelled_at = now(), cancel_reason = 'customer_late' where id = $1`, [IDS.visitNextWeek]),
      bad: await q.attempt(`update public.visits set cancel_reason = 'bored' where id = $1`, [IDS.visitNextWeek]),
    }));
    expect(r).toEqual({ ok: "ok", bad: CHECK });
  });
});
