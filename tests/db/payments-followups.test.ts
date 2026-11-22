// Payments follow-ups (#44) and the jobs' failed calls (#60). intent/payments-followups/plan.md.
import { afterAll, describe, expect, it } from "vitest";
import { as, DENIED, IDS, pool, U, type Query } from "./helpers";

afterAll(() => pool.end());

const today = IDS.visitToday; // Anna's clean today, Tara's (seed)
const PI = "pi_TestFollowUp0001";
const su = (q: Query) => q.rows(`reset role`);
const server = async (q: Query) => { await q.rows(`reset role`); await q.rows(`set local role service_role`); };

type Pay = { id: string; status: string; attempts: number; customer_tries: number; amount_pence: number; application_fee_pence: number;
  cleaner_account_id: string; next_retry_at: Date | null; try_sent_at: Date | null; try_by_customer: boolean; charge_started_at: Date | null };
const pay = async (q: Query) => (await q.rows<Pay>(
  `select id, status::text, attempts::int, customer_tries::int, amount_pence, application_fee_pence, cleaner_account_id, next_retry_at,
          try_sent_at, try_by_customer, charge_started_at
     from public.payments where visit_id = $1 and kind = 'visit'`, [today]))[0]!;

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
  const rows = await q.rows<{ mode: string; attempt: number }>(`select * from public.charge_claim(10)`);
  await su(q);
  return rows;
}
async function result(q: Query, outcome: string, at: Date | null = null) {
  const p = await pay(q);
  await server(q);
  const [r] = await q.rows<{ r: string }>(`select public.stripe_payment_result($1, $2, $3, $4, $5, $6, null, $7, $8) as r`,
    [p.id, PI, outcome, p.amount_pence, p.application_fee_pence, p.cleaner_account_id, outcome === "failed" ? "card_declined" : null, at]);
  await su(q);
  return r!.r;
}
const claim = async (q: Query) => {
  await server(q);
  const rows = await q.rows<{ mode: string; attempt: number }>(`select mode, attempt from public.charge_claim(10)`);
  await su(q);
  return rows;
};
const lost = async (q: Query, chargeAt: Date) => {
  const p = await pay(q);
  await server(q);
  const [r] = await q.rows<{ r: string }>(`select public.charge_try_lost($1, $2) as r`, [p.id, chargeAt]);
  await su(q);
  return r!.r;
};
/** Moves the current try (and the job's last look at it) back in time. */
const age = (q: Query, minutes: number) =>
  q.rows(`update public.payments set try_sent_at = try_sent_at - $2 * interval '1 minute', charge_started_at = charge_started_at - $2 * interval '1 minute'
           where visit_id = $1`, [today, minutes]);
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

/** One failed try, then the retry falls due and the job sends it (the confirm that gets lost). */
async function retrySent(q: Query) {
  await chargeSent(q);
  await result(q, "failed");
  await q.rows(`update public.payments set next_retry_at = now() - interval '1 minute', created_at = now() - interval '2 days',
                       try_sent_at = try_sent_at - interval '1 day', charge_started_at = charge_started_at - interval '1 day' where visit_id = $1`, [today]);
  const [sent] = await claim(q);
  return sent!;
}

describe("1. a retry lost on its way to Stripe", () => {
  it("records when the try was sent, and the job's later check doesn't move it", async () => {
    const r = await as("superuser", async (q) => {
      const sent = await retrySent(q);
      const afterSend = await pay(q);
      await age(q, 11);
      const before = await pay(q);
      const [check] = await claim(q);
      const after = await pay(q);
      return { sent, check, afterSend, kept: after.try_sent_at!.getTime() === before.try_sent_at!.getTime(),
        checkMoved: after.charge_started_at!.getTime() > before.charge_started_at!.getTime() };
    });
    expect(r.sent).toMatchObject({ mode: "retry", attempt: 2 });
    expect(r.afterSend).toMatchObject({ status: "processing", try_by_customer: false });
    expect(r.afterSend.try_sent_at).not.toBeNull();
    expect(r).toMatchObject({ check: { mode: "check" }, kept: true, checkMoved: true });
  });

  it("a failure whose latest charge is older than the try gives the try back, and the same try is sent again", async () => {
    const r = await as("superuser", async (q) => {
      await retrySent(q);
      await age(q, 11);
      await claim(q); // the check
      const answer = await lost(q, minutesAgo(60 * 24)); // the previous try's decline
      const back = await pay(q);
      const [again] = await claim(q);
      const notices = await q.rows(`select kind from private.customer_notices where kind = 'payment_failed'`);
      return { answer, back: [back.status, back.attempts], due: back.next_retry_at!.getTime() <= Date.now(), again, notices: notices.length };
    });
    expect(r).toEqual({ answer: "returned", back: ["failed", 1], due: true, again: { mode: "retry", attempt: 2 }, notices: 1 });
  });

  it("a charge made after the try was sent is a real answer: not lost", async () => {
    const r = await as("superuser", async (q) => {
      await retrySent(q);
      await age(q, 11);
      await claim(q);
      const answer = await lost(q, minutesAgo(5));
      return { answer, still: (await pay(q)).status, then: await result(q, "failed"), after: (await pay(q)).status };
    });
    expect(r).toEqual({ answer: "not_lost", still: "processing", then: "failed", after: "failed" });
  });

  it("a webhook's 'older try' test is measured from the try, not from the job's re-check", async () => {
    const r = await as("superuser", async (q) => {
      await retrySent(q);
      await age(q, 11);
      await claim(q); // moves charge_started_at to now
      // Stripe declined the try 10 minutes ago: after it was sent, before the re-check.
      return { outcome: await result(q, "failed", minutesAgo(10)), status: (await pay(q)).status };
    });
    expect(r).toEqual({ outcome: "failed", status: "failed" });
  });

  it("gives a customer's own lost try back to them, on the schedule it was on", async () => {
    const r = await as("superuser", async (q) => {
      await chargeSent(q);
      await result(q, "failed");
      const before = await pay(q);
      await server(q);
      await q.rows(`select * from public.customer_pay_begin($1, $2)`, [before.id, U.anna]);
      await su(q);
      const mid = await pay(q);
      await age(q, 11);
      await claim(q);
      const answer = await lost(q, minutesAgo(60));
      const after = await pay(q);
      return { mid: [mid.customer_tries, mid.try_by_customer], answer, after: [after.status, after.attempts, after.customer_tries],
        sameSchedule: after.next_retry_at!.getTime() === before.next_retry_at!.getTime() };
    });
    expect(r).toEqual({ mid: [1, true], answer: "returned", after: ["failed", 1, 0], sameSchedule: true });
  });

  it("stops giving tries back three days after the charge first fell due", async () => {
    const r = await as("superuser", async (q) => {
      await retrySent(q);
      await q.rows(`update public.payments set created_at = now() - interval '4 days' where visit_id = $1`, [today]);
      await age(q, 11);
      return lost(q, minutesAgo(60 * 24));
    });
    expect(r).toBe("not_lost");
  });
});

describe("2. no 'confirm your payment' email while the customer is doing it", () => {
  const customerTry = async (q: Query) => {
    await chargeSent(q);
    await result(q, "failed");
    const p = await pay(q);
    await server(q);
    await q.rows(`select * from public.customer_pay_begin($1, $2)`, [p.id, U.anna]);
    await su(q);
  };
  const confirming = (q: Query) => q.rows(`select kind from private.customer_notices where kind = 'payment_needs_confirming'`);

  it("the webhook for the customer's own fresh try changes nothing and emails nobody", async () => {
    const r = await as("superuser", async (q) => {
      await customerTry(q);
      return { outcome: await result(q, "requires_action"), status: (await pay(q)).status, emails: (await confirming(q)).length };
    });
    expect(r).toEqual({ outcome: "ignored", status: "processing", emails: 0 });
  });

  it("if they walk away, the job's check after 10 minutes sends the email", async () => {
    const r = await as("superuser", async (q) => {
      await customerTry(q);
      await age(q, 11);
      return { outcome: await result(q, "requires_action"), status: (await pay(q)).status, emails: (await confirming(q)).length };
    });
    expect(r).toEqual({ outcome: "requires_action", status: "requires_action", emails: 1 });
  });

  it("the job's own try still emails at once", async () => {
    const r = await as("superuser", async (q) => {
      await chargeSent(q);
      return { outcome: await result(q, "requires_action"), emails: (await confirming(q)).length };
    });
    expect(r).toEqual({ outcome: "requires_action", emails: 1 });
  });
});

describe("3. a limit on the pay page's calls to Stripe", () => {
  const call = async (q: Query, kind: string, who: string = U.anna) =>
    (await q.rows<{ r: boolean }>(`select public.customer_stripe_call($1, $2) as r`, [who, kind]))[0]!.r;

  it("lets six card forms an hour through, then says no, per customer, until the hour is up", async () => {
    const r = await as("superuser", async (q) => {
      await server(q);
      const anna: boolean[] = [];
      for (let i = 0; i < 7; i++) anna.push(await call(q, "card_form"));
      const ben = await call(q, "card_form", U.ben);
      const check = await call(q, "check");
      await su(q);
      await q.rows(`update private.customer_stripe_calls set window_start = now() - interval '61 minutes' where customer_id = $1`, [U.anna]);
      await server(q);
      const later = await call(q, "card_form");
      await su(q);
      return { anna, ben, check, later };
    });
    expect(r).toEqual({ anna: [true, true, true, true, true, true, false], ben: true, check: true, later: true });
  });

  it("allows thirty checks an hour", async () => {
    const r = await as("superuser", async (q) => {
      await server(q);
      const got: boolean[] = [];
      for (let i = 0; i < 31; i++) got.push(await call(q, "check"));
      return got.filter(Boolean).length;
    });
    expect(r).toBe(30);
  });

  it("refuses a kind it doesn't know", async () => {
    expect(await as("superuser", async (q) => { await server(q); return q.attempt(`select public.customer_stripe_call($1, 'refund')`, [U.anna]); })).toBe("22023");
  });
});

describe("4. the cleaner is told about a hold, and never why", () => {
  const cleanerNotices = (q: Query) => q.rows<{ kind: string; customer_id: string; payment_id: string | null; series_id: string }>(
    `select kind, customer_id, payment_id, series_id from private.customer_notices where kind like 'cleaner\\_%' order by kind`);
  const lastTryFailed = async (q: Query) => {
    await q.rows(`update public.settings set payment_retry_hours = null`);
    await chargeSent(q);
    await result(q, "failed");
  };

  it("emails the cleaner once when the block goes on hold: the block, not the payment", async () => {
    const r = await as("superuser", async (q) => {
      await lastTryFailed(q);
      await result(q, "failed"); // a replay changes nothing
      return cleanerNotices(q);
    });
    expect(r).toEqual([{ kind: "cleaner_block_on_hold", customer_id: U.tara, payment_id: null, series_id: IDS.annaSeries }]);
  });

  it("hands the sender the cleaner's address, the town and the day, and no amount or date", async () => {
    const r = await as("superuser", async (q) => {
      await lastTryFailed(q);
      await server(q);
      const got = await q.rows<Record<string, unknown>>(`select * from public.notices_claim(20)`);
      await su(q);
      const [tara] = await q.rows<{ email: string }>(`select email from public.profiles where id = $1`, [U.tara]);
      const [s] = await q.rows<{ town: string; day: number }>(
        `select p.town, s.preferred_day as day from public.series s join public.properties p on p.id = s.property_id where s.id = $1`, [IDS.annaSeries]);
      return { mine: got.find((n) => n.kind === "cleaner_block_on_hold"), tara: tara!.email, s: s! };
    });
    expect(r.mine).toMatchObject({ email: r.tara, payment_id: null, amount_pence: null, clean_date: null, town: r.s.town, weekday: r.s.day });
  });

  it("emails them when it's back on", async () => {
    const r = await as("superuser", async (q) => {
      await lastTryFailed(q);
      await result(q, "succeeded");
      return (await cleanerNotices(q)).map((n) => n.kind);
    });
    expect(r).toEqual(["cleaner_block_back_on", "cleaner_block_on_hold"]); // (one transaction: in kind order)
  });

  it("emails them when it ends on hold", async () => {
    const r = await as("superuser", async (q) => {
      await lastTryFailed(q);
      await q.rows(`update private.series_holds set held_at = now() - interval '30 days'`);
      await q.rows(`select private.run_payment_holds()`);
      return (await cleanerNotices(q)).map((n) => [n.kind, n.customer_id]);
    });
    expect(r).toEqual([["cleaner_block_ended", U.tara], ["cleaner_block_on_hold", U.tara]]);
  });

  it("a cleaner's notice can never carry a payment", async () => {
    const r = await as("superuser", async (q) => {
      await chargeSent(q);
      const p = await pay(q);
      return q.attempt(`insert into private.customer_notices (customer_id, kind, payment_id, series_id, dedupe) values ($1, 'cleaner_block_on_hold', $2, $3, 'x')`,
        [U.tara, p.id, IDS.annaSeries]);
    });
    expect(r).toBe("23514");
  });
});

describe("5. a late card webhook never replaces a newer card", () => {
  const SAVE = `select public.stripe_card_saved($1, 'cus_TestAnna01', $2, 'visa', $3, 12::smallint, 2030::smallint, $4) as r`;
  const card = async (q: Query) => (await q.rows<{ pm: string; last4: string }>(
    `select default_payment_method_id as pm, card_last4 as last4 from private.customer_billing where customer_id = $1`, [U.anna]))[0]!;

  it("keeps the newer card when the older SetupIntent's webhook arrives late; the same one again is fine", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`insert into private.customer_billing (customer_id, stripe_customer_id) values ($1, 'cus_TestAnna01')`, [U.anna]);
      await server(q);
      const newer = (await q.rows<{ r: string }>(SAVE, [IDS.annaSeries, "pm_TestNewCard01", "1111", minutesAgo(1)]))[0]!.r;
      const older = (await q.rows<{ r: string }>(SAVE, [IDS.annaSeries, "pm_TestOldCard01", "2222", minutesAgo(30)]))[0]!.r;
      const replay = (await q.rows<{ r: string }>(SAVE, [IDS.annaSeries, "pm_TestNewCard01", "1111", minutesAgo(1)]))[0]!.r;
      await su(q);
      const [block] = await q.rows(`select stripe_payment_method_id as pm from public.series_billing where series_id = $1`, [IDS.annaSeries]);
      return { newer, older, replay, card: await card(q), block };
    });
    expect(r).toEqual({ newer: "saved", older: "older", replay: "saved", card: { pm: "pm_TestNewCard01", last4: "1111" }, block: { pm: "pm_TestNewCard01" } });
  });

  it("an older card still gives a block with no card its card", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`insert into private.customer_billing (customer_id, stripe_customer_id) values ($1, 'cus_TestAnna01')`, [U.anna]);
      await server(q);
      await q.rows(SAVE, [IDS.annaSeries, "pm_TestNewCard01", "1111", minutesAgo(1)]);
      await su(q);
      await q.rows(`delete from public.series_billing where series_id = $1`, [IDS.annaSeries]);
      await server(q);
      const older = (await q.rows<{ r: string }>(SAVE, [IDS.annaSeries, "pm_TestOldCard01", "2222", minutesAgo(30)]))[0]!.r;
      await su(q);
      const [block] = await q.rows(`select stripe_payment_method_id as pm from public.series_billing where series_id = $1`, [IDS.annaSeries]);
      return { older, card: await card(q), block };
    });
    expect(r).toEqual({ older: "older", card: { pm: "pm_TestNewCard01", last4: "1111" }, block: { pm: "pm_TestOldCard01" } });
  });
});

describe("#60. a job call that didn't come back 200 tells the office", () => {
  /** Stand-ins for Supabase's pg_net and Vault, inside this test's transaction only. */
  async function liveLike(q: Query, url = "https://ping.example.co.uk/api/stripe/charge-due") {
    await q.rows(`create schema net`);
    await q.rows(`create table net._http_response (id bigint primary key, status_code integer, timed_out boolean, error_msg text, created timestamptz default now())`);
    await q.rows(`create sequence net.req`);
    await q.rows(`create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) returns bigint language sql as 'select nextval(''net.req'')'`);
    await q.rows(`create schema vault`);
    await q.rows(`create table vault.decrypted_secrets (name text, decrypted_secret text)`);
    await q.rows(`insert into vault.decrypted_secrets values ('ping_charge_job_url', $1), ('ping_job_secret', repeat('s', 40))`, [url]);
  }
  const kick = async (q: Query, job = "charge") => (await q.rows<{ r: string }>(`select private.kick_${job}_job() as r`))[0]!.r;
  const open = (q: Query) => q.rows<{ message: string }>(`select message from public.engine_alerts where kind = 'job_call_failed' and resolved_at is null`);
  const answer = async (q: Query, job: string, status: number | null, timedOut = false) => {
    const [c] = await q.rows<{ request_id: number }>(`select request_id from private.job_calls where job = $1`, [job]);
    await q.rows(`insert into net._http_response (id, status_code, timed_out) values ($1, $2, $3)`, [c!.request_id, status, timedOut]);
  };

  it("a 401 raises one alert for the charge job, which a 200 later closes", async () => {
    const r = await as("superuser", async (q) => {
      await liveLike(q);
      await chargeSent(q);
      await q.rows(`update public.payments set next_retry_at = null, status = 'failed' where visit_id = $1`, [today]);
      await q.rows(`update public.payments set next_retry_at = now() - interval '1 minute' where visit_id = $1`, [today]);
      const first = await kick(q);
      const waiting = (await open(q)).length;
      await answer(q, "charge", 401);
      await kick(q);
      const after401 = await open(q);
      await kick(q); // a second 401 doesn't stack
      await answer(q, "charge", 401);
      await kick(q);
      const still = (await open(q)).length;
      await answer(q, "charge", 200);
      await kick(q);
      return { first, waiting, after401: after401.map((a) => a.message), still, closed: (await open(q)).length };
    });
    expect(r.first).toBe("kicked");
    expect(r.waiting).toBe(0);
    expect(r.after401).toHaveLength(1);
    expect(r.after401[0]).toMatch(/charge job.*HTTP 401.*ping_job_secret.*\[charge job\]$/);
    expect(r).toMatchObject({ still: 1, closed: 0 });
  });

  it("a redirect, a timeout and no answer at all are alerts too; for the payout job as well", async () => {
    const r = await as("superuser", async (q) => {
      await liveLike(q);
      await q.rows(`insert into private.job_calls (job, request_id, called_at) values ('payout', 900, now())`);
      await q.rows(`insert into net._http_response (id, status_code) values (900, 308)`);
      await kick(q, "payout");
      const redirect = (await open(q)).map((a) => a.message);
      await q.rows(`update public.engine_alerts set resolved_at = now() where kind = 'job_call_failed'`);
      await q.rows(`insert into private.job_calls (job, request_id, called_at) values ('charge', 901, now())`);
      await q.rows(`insert into net._http_response (id, status_code, timed_out) values (901, null, true)`);
      await kick(q);
      const timeout = (await open(q)).map((a) => a.message);
      await q.rows(`update public.engine_alerts set resolved_at = now() where kind = 'job_call_failed'`);
      await q.rows(`update private.job_calls set request_id = 902, called_at = now() - interval '2 minutes', checked_at = null where job = 'charge'`);
      await kick(q);
      const tooSoon = (await open(q)).length;
      await q.rows(`update private.job_calls set called_at = now() - interval '11 minutes' where job = 'charge'`);
      await kick(q);
      return { redirect, timeout, tooSoon, silent: (await open(q)).map((a) => a.message) };
    });
    expect(r.redirect).toEqual([expect.stringMatching(/payout job.*HTTP 308.*redirected.*\[payout job\]$/)]);
    expect(r.timeout).toEqual([expect.stringMatching(/charge job.*timed out.*\[charge job\]$/)]);
    expect(r.tooSoon).toBe(0);
    expect(r.silent).toEqual([expect.stringMatching(/never heard back.*\[charge job\]$/)]);
  });

  it("a mistyped Vault value while work is due is an alert, not a quiet 'not set up'", async () => {
    const r = await as("superuser", async (q) => {
      await liveLike(q, "https://ping.example.co.uk/api/stripe/charge-du");
      await chargeSent(q);
      await q.rows(`update public.payments set status = 'failed', next_retry_at = now() - interval '1 minute' where visit_id = $1`, [today]);
      return { kicked: await kick(q), again: await kick(q), alerts: (await open(q)).map((a) => a.message) };
    });
    expect(r).toEqual({ kicked: "not_set_up", again: "not_set_up", alerts: [expect.stringMatching(/missing or mistyped.*\[charge job\]$/)] });
  });

  it("nothing due and nothing called: no alert", async () => {
    const r = await as("superuser", async (q) => {
      await liveLike(q);
      return { kicked: await kick(q), alerts: (await open(q)).length };
    });
    expect(r).toEqual({ kicked: "nothing_due", alerts: 0 });
  });
});

describe("who may do what", () => {
  it("only the server can give a try back or count a call", async () => {
    for (const who of ["tara", "anna", "admin", "anon"] as const) {
      const codes = await as(who, async (q) => [
        await q.attempt(`select public.charge_try_lost(gen_random_uuid(), now())`),
        await q.attempt(`select public.customer_stripe_call($1, 'check')`, [U.anna]),
        await q.attempt(`select private.check_job_call('charge')`),
        await q.attempt(`select private.queue_cleaner_notice('cleaner_block_on_hold', $1, 'x')`, [IDS.annaSeries]),
        await q.attempt(`select * from private.customer_stripe_calls`),
        await q.attempt(`select * from private.job_calls`),
        await q.attempt(`select public.stripe_card_saved($1, 'cus_x', 'pm_x', 'visa', '4242', 1::smallint, 2030::smallint, now())`, [IDS.annaSeries]),
      ]);
      expect({ who, codes }).toEqual({ who, codes: [DENIED, DENIED, DENIED, DENIED, DENIED, DENIED, DENIED] });
    }
  });

  it("customers never see when a try was sent or whose it was", async () => {
    const r = await as("superuser", async (q) => {
      await chargeSent(q);
      await q.actAs(U.anna);
      return [await q.attempt(`select try_sent_at from public.payments`), await q.attempt(`select try_by_customer from public.payments`)];
    });
    expect(r).toEqual([DENIED, DENIED]);
  });
});
