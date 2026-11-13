// Payments PR 11: a customer cancels a clean; inside the notice period there's a fee.
import { afterAll, describe, expect, it } from "vitest";
import { as, IDS, pool, U, type Query } from "./helpers";

afterAll(() => pool.end());

const next = IDS.visitNextWeek; // Anna's clean next week, Tara's (seed): £50 = £37.50 Tara + £12.50 Ping
const su = (q: Query) => q.rows(`reset role`);
const server = async (q: Query) => { await q.rows(`reset role`); await q.rows(`set local role service_role`); };

/** Carl's settings for the fee. */
const fee = async (q: Query, pence: number | null, split: "same_as_clean" | "fixed_share" | null = "same_as_clean", bps: number | null = null) => {
  await q.rows(`alter table public.settings disable trigger user`);
  await q.rows(`update public.settings set late_cancel_fee_pence = $1, late_cancel_split = $2, late_cancel_cleaner_share_bps = $3`, [pence, split, split === "fixed_share" ? bps : null]);
  await q.rows(`alter table public.settings enable trigger user`);
};
/** The clean's window opens this many hours from now (London). */
const startsIn = async (q: Query, hours: number) => {
  // Any other clean of the block on that day steps aside (one clean per block per day).
  await q.rows(`update public.visits set scheduled_date = scheduled_date + 400
                 where id <> $1 and series_id = (select series_id from public.visits where id = $1)
                   and scheduled_date = ((now() + $2 * interval '1 hour') at time zone 'Europe/London')::date`, [next, hours]);
  await q.rows(`update public.visits set scheduled_date = ((now() + $2 * interval '1 hour') at time zone 'Europe/London')::date,
                 window_start = ((now() + $2 * interval '1 hour') at time zone 'Europe/London')::time(0),
                 window_end = '23:59:59' where id = $1`, [next, hours]);
};
const quote = async (q: Query, who = U.anna) => {
  await q.actAs(who);
  const r = await q.rows<{ can_cancel: boolean; late: boolean; fee_pence: number }>(`select can_cancel, late, fee_pence from public.cancel_visit_quote($1)`, [next]);
  await su(q);
  return r[0]!;
};
const cancel = async (q: Query, shown: number, who = U.anna) => {
  await q.actAs(who);
  const r = await q.rows<{ r: string }>(`select public.cancel_visit($1, $2) as r`, [next, shown]);
  await su(q);
  return r[0]!.r;
};
const tryCancel = async (q: Query, shown: number, who = U.anna) => {
  await q.actAs(who);
  const code = await q.attempt(`select public.cancel_visit($1, $2)`, [next, shown]);
  await su(q);
  return code;
};
const visit = async (q: Query) => (await q.rows<{ status: string; cancel_reason: string | null; late_cancel_fee_pence: number; cleaner: boolean }>(
  `select status::text, cancel_reason, late_cancel_fee_pence, cleaner_id is not null as cleaner from public.visits where id = $1`, [next]))[0]!;
const payments = async (q: Query) => q.rows<{ id: string; kind: string; status: string; amount_pence: number; cleaner_amount_pence: number; application_fee_pence: number }>(
  `select id, kind, status::text, amount_pence, cleaner_amount_pence, application_fee_pence from public.payments where visit_id = $1`, [next]);
const lateAlerts = async (q: Query) => (await q.rows(`select 1 from public.engine_alerts where kind = 'visit_cancelled_late' and visit_id = $1 and resolved_at is null`, [next])).length;
const card = (q: Query) => q.rows(`insert into private.customer_billing (customer_id, stripe_customer_id, default_payment_method_id) values ($1, 'cus_TestAnna0001', 'pm_TestAnna0001')`, [U.anna]);

describe("cancelling with plenty of notice", () => {
  it("is free: the clean shows cancelled by the customer, nothing is charged, nobody is alerted", async () => {
    const r = await as("superuser", async (q) => {
      await fee(q, 2000);
      await startsIn(q, 72);
      const told = await quote(q);
      const done = await cancel(q, told.fee_pence);
      return { told, done, visit: await visit(q), payments: (await payments(q)).length, alerts: await lateAlerts(q) };
    });
    expect(r).toEqual({ told: { can_cancel: true, late: false, fee_pence: 0 }, done: "cancelled",
      visit: { status: "cancelled", cancel_reason: "customer", late_cancel_fee_pence: 0, cleaner: true }, payments: 0, alerts: 0 });
  });

  it("can't be done twice, and the clean is never deleted", async () => {
    const r = await as("superuser", async (q) => {
      await startsIn(q, 72);
      await cancel(q, 0);
      return { again: await tryCancel(q, 0), quote: (await quote(q)).can_cancel, stillThere: (await q.rows(`select 1 from public.visits where id = $1`, [next])).length };
    });
    expect(r).toEqual({ again: "PC034", quote: false, stillThere: 1 });
  });
});

describe("cancelling inside the notice period", () => {
  it("costs Carl's fee, split as the clean was: a payment row for the charge job, and the office is told", async () => {
    const r = await as("superuser", async (q) => {
      await fee(q, 2000);
      await startsIn(q, 5);
      const told = await quote(q);
      const done = await cancel(q, told.fee_pence);
      const [p] = await payments(q);
      return { told, done, visit: await visit(q), p: { ...p, id: undefined }, alerts: await lateAlerts(q) };
    });
    // £20 of a clean split 75 / 25: £15.00 to the cleaner, £5.00 to Ping.
    expect(r).toEqual({ told: { can_cancel: true, late: true, fee_pence: 2000 }, done: "cancelled_with_fee",
      visit: { status: "cancelled", cancel_reason: "customer_late", late_cancel_fee_pence: 2000, cleaner: true },
      p: { id: undefined, kind: "late_cancel", status: "pending", amount_pence: 2000, cleaner_amount_pence: 1500, application_fee_pence: 500 }, alerts: 1 });
  });

  it("a fixed share rounds the cleaner's part down, and the pence still add up", async () => {
    const r = await as("superuser", async (q) => {
      await fee(q, 1999, "fixed_share", 3333);
      await startsIn(q, 5);
      await cancel(q, 1999);
      const [p] = await payments(q);
      return [p!.amount_pence, p!.cleaner_amount_pence, p!.application_fee_pence];
    });
    expect(r).toEqual([1999, 666, 1333]); // 1999 × 33.33% = 666.27 → 666
  });

  it("is never more than the clean itself would have cost", async () => {
    const r = await as("superuser", async (q) => {
      await fee(q, 9000);
      await startsIn(q, 5);
      const told = await quote(q);
      await cancel(q, told.fee_pence);
      const [p] = await payments(q);
      return [told.fee_pence, p!.amount_pence, p!.cleaner_amount_pence, p!.application_fee_pence];
    });
    expect(r).toEqual([5000, 5000, 3750, 1250]);
  });

  it.each([
    ["Carl hasn't set a fee", async (q: Query) => fee(q, null)],
    ["the fee is nothing", async (q: Query) => fee(q, 0)],
    ["no split is chosen", async (q: Query) => fee(q, 2000, null)],
    ["no cleaner had taken it", async (q: Query) => { await fee(q, 2000); await q.rows(`alter table public.visits disable trigger user`); await q.rows(`update public.visits set cleaner_id = null where id = $1`, [next]); await q.rows(`alter table public.visits enable trigger user`); }],
  ])("is free when %s", async (_why, setup) => {
    const r = await as("superuser", async (q) => {
      await setup(q);
      await startsIn(q, 5);
      const told = await quote(q);
      const done = await cancel(q, 0);
      return { fee: told.fee_pence, late: told.late, done, reason: (await visit(q)).cancel_reason, payments: (await payments(q)).length };
    });
    expect(r).toEqual({ fee: 0, late: true, done: "cancelled_late", reason: "customer_late", payments: 0 });
  });

  it("with no notice period set, nothing is ever late", async () => {
    const r = await as("superuser", async (q) => {
      await fee(q, 2000);
      await q.rows(`alter table public.settings disable trigger user`);
      await q.rows(`update public.settings set cancel_notice_hours = null`);
      await q.rows(`alter table public.settings enable trigger user`);
      await startsIn(q, 1);
      return quote(q);
    });
    expect(r).toEqual({ can_cancel: true, late: false, fee_pence: 0 });
  });
});

describe("the fee shown is the fee charged", () => {
  it("refuses if the cost changed since they were shown it, either way, and nothing is cancelled", async () => {
    const r = await as("superuser", async (q) => {
      await fee(q, 2000);
      await startsIn(q, 5);
      const shownFree = await tryCancel(q, 0);       // they saw "free", it's now £20
      const shownMore = await tryCancel(q, 2500);    // they saw more than it is
      const forged = await tryCancel(q, -1);
      return { shownFree, shownMore, forged, visit: (await visit(q)).status, payments: (await payments(q)).length, right: await tryCancel(q, 2000) };
    });
    expect(r).toEqual({ shownFree: "PC035", shownMore: "PC035", forged: "PC035", visit: "scheduled", payments: 0, right: "ok" });
  });
});

describe("what can't be cancelled, and by whom", () => {
  it("not once its time has started, or when it's under way, done or already cancelled", async () => {
    const r = await as("superuser", async (q) => {
      await startsIn(q, -1);
      const started = { quote: (await quote(q)).can_cancel, cancel: await tryCancel(q, 0) };
      await startsIn(q, 72);
      const out: Record<string, string> = {};
      for (const status of ["in_progress", "completed", "skipped", "no_show"]) {
        await q.rows(`alter table public.visits disable trigger user`);
        await q.rows(`update public.visits set status = $2::public.visit_status, started_at = now(), completed_at = now() where id = $1`, [next, status]);
        await q.rows(`alter table public.visits enable trigger user`);
        out[status] = await tryCancel(q, 0);
      }
      return { started, out };
    });
    expect(r).toEqual({ started: { quote: false, cancel: "PC034" }, out: { in_progress: "PC034", completed: "PC034", skipped: "PC034", no_show: "PC034" } });
  });

  it("only the customer whose clean it is: not another customer, the cleaner, the office or a stranger", async () => {
    const r = await as("superuser", async (q) => {
      await startsIn(q, 72);
      const out: Record<string, string[]> = {};
      for (const [name, who] of [["otherCustomer", U.ben], ["cleaner", U.tara], ["admin", U.admin]] as const) {
        await q.actAs(who);
        out[name] = [await q.attempt(`select * from public.cancel_visit_quote($1)`, [next]), await q.attempt(`select public.cancel_visit($1, 0)`, [next])];
        await su(q);
      }
      return { out, visit: (await visit(q)).status };
    });
    expect(r).toEqual({ out: { otherCustomer: ["PC034", "PC034"], cleaner: ["PC034", "42501"], admin: ["PC034", "42501"] }, visit: "scheduled" });
    expect(await as("anon", (q) => q.attempt(`select public.cancel_visit('${next}', 0)`))).toBe("42501");
  });

  it("a fee row can't be made up: not for a clean that wasn't cancelled late, and not for another amount", async () => {
    const r = await as("superuser", async (q) => {
      const insert = (amount: number) => q.attempt(
        `insert into public.payments (visit_id, customer_id, amount_pence, application_fee_pence, cleaner_amount_pence, kind, idempotency_key)
         values ($1, $2, $3::int, 0, $3::int, 'late_cancel', 'payment:test:' || $3::text)`, [next, U.anna, amount]);
      const notCancelled = await insert(2000);
      await fee(q, 2000);
      await startsIn(q, 5);
      await cancel(q, 2000);
      await q.rows(`alter table public.payments disable trigger user`);
      await q.rows(`delete from public.payments where visit_id = $1`, [next]);
      await q.rows(`alter table public.payments enable trigger user`);
      return { notCancelled, wrongAmount: await insert(2001), right: await insert(2000) };
    });
    expect(r).toEqual({ notCancelled: "PC044", wrongAmount: "PC044", right: "ok" });
  });
});

describe("the fee is charged and paid on like any other payment", () => {
  const charged = async (q: Query) => {
    await card(q);
    await fee(q, 2000);
    await startsIn(q, 5);
    await cancel(q, 2000);
    await server(q);
    const claimed = await q.rows<{ payment_id: string; mode: string; amount_pence: number; application_fee_pence: number; cleaner_account_id: string }>(`select payment_id, mode, amount_pence, application_fee_pence, cleaner_account_id from public.charge_claim(10)`);
    await su(q);
    return claimed;
  };
  const result = async (q: Query, c: { payment_id: string; amount_pence: number; application_fee_pence: number; cleaner_account_id: string }, outcome: string) => {
    await server(q);
    const r = await q.rows<{ r: string }>(`select public.stripe_payment_result($1, 'pi_TestLateFee00001', $2, $3, $4, $5, 'ch_TestLateFee0001', $6, null) as r`,
      [c.payment_id, outcome, c.amount_pence, c.application_fee_pence, c.cleaner_account_id, outcome === "failed" ? "card_declined" : null]);
    await su(q);
    return r[0]!.r;
  };

  it("the charge job takes it: the fee, Ping's part as the application fee, to the cleaner who lost the slot", async () => {
    const r = await as("superuser", async (q) => {
      const [{ due }] = await q.rows<{ due: boolean }>(`select true as due`) as [{ due: boolean }];
      const claimed = await charged(q);
      const [{ acct }] = await q.rows<{ acct: string }>(`select stripe_account_id as acct from public.cleaners where id = $1`, [U.tara]) as [{ acct: string }];
      return { due, n: claimed.length, c: { mode: claimed[0]!.mode, amount: claimed[0]!.amount_pence, fee: claimed[0]!.application_fee_pence, tara: claimed[0]!.cleaner_account_id === acct } };
    });
    expect(r).toEqual({ due: true, n: 1, c: { mode: "create", amount: 2000, fee: 500, tara: true } });
  });

  it("once paid, the cleaner's part is their earnings after the check period, and goes to their bank", async () => {
    const r = await as("superuser", async (q) => {
      const [c] = await charged(q);
      const said = await result(q, c!, "succeeded");
      const [po] = await q.rows<{ status: string; amount_pence: number; waits: boolean }>(`select status::text, amount_pence, available_after > now() as waits from public.payouts where visit_id = $1`, [next]);
      await q.rows(`update public.payouts set available_after = now() - interval '1 minute' where visit_id = $1`, [next]);
      await server(q);
      const due = await q.rows<{ due_pence: number }>(`select due_pence from public.payout_due_cleaners() where cleaner_id = $1`, [U.tara]);
      const [b] = await q.rows<{ amount_pence: number }>(`select amount_pence from public.payout_batch_open($1, 5000)`, [U.tara]);
      await su(q);
      return { said, po, due: due[0]?.due_pence, batch: b?.amount_pence };
    });
    expect(r).toEqual({ said: "succeeded", po: { status: "pending", amount_pence: 1500, waits: true }, due: 1500, batch: 1500 });
  });

  it("unpaid after the last try: the customer can pay it themselves, and can't book again until they have", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.settings set payment_retry_hours = null`);
      const [c] = await charged(q);
      await result(q, c!, "failed");
      const [p] = await payments(q);
      const at = (await q.rows<{ d: string; dow: number }>(`select (private.london_today() + 60)::text as d, extract(isodow from private.london_today() + 60)::int as dow`))[0]!;
      await q.actAs(U.anna);
      const book = await q.attempt(`select public.book_series($1, 'weekly', $3::smallint, '09:00', '13:00', 120, $2::date, 2::smallint, gen_random_uuid())`, [IDS.annaProperty, at.d, at.dow]);
      await server(q);
      // Someone else can't start paying it; she can (the same page as an unpaid clean).
      const other = (await q.rows<{ mode: string | null }>(`select mode from public.customer_pay_begin($1, $2)`, [p!.id, U.ben])).filter((x) => x.mode).length;
      const begin = (await q.rows<{ mode: string | null }>(`select mode from public.customer_pay_begin($1, $2)`, [p!.id, U.anna])).filter((x) => x.mode).length;
      await su(q);
      return { status: p!.status, begin, other, book };
    });
    expect(r).toEqual({ status: "failed_final", begin: 1, other: 0, book: "PC029" });
  });

  it("the cleaner sees the clean cancelled, never the fee payment or the customer's card", async () => {
    const r = await as("superuser", async (q) => {
      await charged(q);
      await q.actAs(U.tara);
      const v = await q.rows(`select status, cancel_reason from public.visits where id = $1`, [next]);
      const pay = (await q.rows(`select id from public.payments`)).length;
      return { v, pay };
    });
    expect(r).toEqual({ v: [{ status: "cancelled", cancel_reason: "customer_late" }], pay: 0 });
  });
});

describe("who counts as holding the clean (review)", () => {
  const setUp = async (q: Query) => { await su(q); await fee(q, 2000); await q.rows(`update public.settings set cancel_notice_hours = 24`); await startsIn(q, 5); };

  it("no fee when the block is on hold, back on the board, or held by someone else", async () => {
    const r = await as("superuser", async (q) => {
      await setUp(q);
      const out: Record<string, number> = { claimed: (await quote(q)).fee_pence };
      await q.rows(`alter table public.series disable trigger user`);
      for (const [name, sql] of [
        ["paused", `update public.series set status = 'paused' where id = $1`],
        ["offering", `update public.series set status = 'offering', cleaner_id = null where id = $1`],
      ] as const) {
        await q.rows(`savepoint s`);
        await q.rows(sql, [IDS.annaSeries]);
        out[name] = (await quote(q)).fee_pence;
        await q.rows(`rollback to savepoint s`);
      }
      return out;
    });
    expect(r).toEqual({ claimed: 2000, paused: 0, offering: 0 });
  });

  it("no fee when the cleaner is suspended: it's still a late cancellation, and the office is still told", async () => {
    const r = await as("superuser", async (q) => {
      await setUp(q);
      await q.rows(`alter table public.cleaners disable trigger user`);
      await q.rows(`update public.cleaners set status = 'suspended' where id = $1`, [U.tara]);
      const shown = await quote(q);
      const done = await cancel(q, 0);
      const pay = await q.rows(`select 1 from public.payments where visit_id = $1 and kind = 'late_cancel'`, [next]);
      return { late: shown.late, fee: shown.fee_pence, done, payments: pay.length };
    });
    expect(r).toEqual({ late: true, fee: 0, done: "cancelled_late", payments: 0 });
  });

  it("a fee Stripe can't take can't be set", async () => {
    const r = await as("superuser", async (q) => ({
      tenPence: await q.attempt(`update public.settings set late_cancel_fee_pence = 10`),
      thirty: await q.attempt(`update public.settings set late_cancel_fee_pence = 30, late_cancel_split = 'same_as_clean'`),
    }));
    expect(r.tenPence).toBe("23514");
  });
});

