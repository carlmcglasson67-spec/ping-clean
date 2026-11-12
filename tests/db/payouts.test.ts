// Payments PR 9: paying cleaners after the check period.
import { afterAll, describe, expect, it } from "vitest";
import { as, IDS, pool, U, type Query } from "./helpers";

afterAll(() => pool.end());

const today = IDS.visitToday; // Anna's clean today, Tara's (seed): £50 = £37.50 Tara + £12.50 Ping
const PI = "pi_TestPayout00001";
const PO = "po_TestPayout00001";
const su = (q: Query) => q.rows(`reset role`);
const server = async (q: Query) => { await q.rows(`reset role`); await q.rows(`set local role service_role`); };

/** Tara completes Anna's clean today, it's charged, and Stripe says the payment went through. */
async function paid(q: Query) {
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
  const [p] = await q.rows<{ id: string; amount_pence: number; application_fee_pence: number; cleaner_account_id: string }>(
    `select id, amount_pence, application_fee_pence, cleaner_account_id from public.payments where visit_id = $1 and kind = 'visit'`, [today]);
  await server(q);
  await q.rows(`select public.stripe_payment_result($1, $2, 'succeeded', $3, $4, $5, 'ch_TestPayout0001', null, null)`,
    [p!.id, PI, p!.amount_pence, p!.application_fee_pence, p!.cleaner_account_id]);
  await su(q);
  return p!;
}
const row = async (q: Query) => (await q.rows<{ status: string; amount_pence: number; hours: number; batch: boolean; po: string | null; paid: boolean }>(
  `select po.status::text, po.amount_pence, round(extract(epoch from po.available_after - v.completed_at) / 3600)::int as hours,
          po.batch_id is not null as batch, po.stripe_payout_id as po, po.paid_at is not null as paid
     from public.payouts po join public.visits v on v.id = po.visit_id where po.visit_id = $1`, [today]))[0];
const past = (q: Query) => q.rows(`update public.payouts set available_after = now() - interval '1 minute' where visit_id = $1`, [today]);
const due = async (q: Query) => { await server(q); const r = await q.rows<{ cleaner_id: string; cleaner_account_id: string; due_pence: number }>(`select * from public.payout_due_cleaners()`); await su(q); return r; };
const open = async (q: Query, available: number) => { await server(q); const r = await q.rows<{ batch_id: string; cleaner_account_id: string; amount_pence: number; idempotency_key: string }>(`select * from public.payout_batch_open($1, $2)`, [U.tara, available]); await su(q); return r; };
const taraAcct = async (q: Query) => (await q.rows<{ a: string }>(`select stripe_account_id as a from public.cleaners where id = $1`, [U.tara]))[0]!.a;
const result = async (q: Query, batch: string, outcome: string, over: { po?: string; acct?: string; amount?: number; error?: string | null } = {}) => {
  const acct = over.acct ?? await taraAcct(q);
  await server(q);
  const r = await q.rows<{ r: string }>(`select public.stripe_payout_result($1, $2, $3, $4, $5, current_date + 2, $6) as r`,
    [batch, over.po ?? PO, acct, outcome, over.amount ?? 3750, over.error ?? null]);
  await su(q);
  return r[0]!.r;
};
const sent = async (q: Query, batch: string) => { await server(q); const r = await q.rows<{ r: string }>(`select public.payout_batch_sent($1, $2, current_date + 2) as r`, [batch, PO]); await su(q); return r[0]!.r; };
const batch = async (q: Query, id: string) => (await q.rows<{ status: string; amount_pence: number; po: string | null }>(`select status, amount_pence, stripe_payout_id as po from public.payout_batches where id = $1`, [id]))[0];
const alerts = async (q: Query) => (await q.rows<{ kind: string }>(`select kind from public.engine_alerts where kind like 'payout%' and resolved_at is null`)).map((a) => a.kind);

describe("a paid clean becomes earnings waiting", () => {
  it("writes one payout row for the cleaner's part, available after Carl's check period from the clean", async () => {
    const r = await as("superuser", async (q) => {
      const [{ hours }] = await q.rows<{ hours: number }>(`select dispute_window_hours as hours from public.settings`) as [{ hours: number }];
      await paid(q);
      const n = (await q.rows(`select 1 from public.payouts where visit_id = $1`, [today])).length;
      return { n, row: await row(q), window: hours };
    });
    expect(r.n).toBe(1);
    expect(r.row).toEqual({ status: "pending", amount_pence: 3750, hours: r.window, batch: false, po: null, paid: false });
  });

  it("writes nothing until the payment has actually succeeded, and nothing twice", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      // The same success again (job and webhook both report it).
      await server(q);
      await q.rows(`select public.stripe_payment_result($1, $2, 'succeeded', $3, $4, $5, 'ch_TestPayout0001', null, null)`, [p.id, PI, p.amount_pence, p.application_fee_pence, p.cleaner_account_id]);
      await su(q);
      const after = (await q.rows(`select 1 from public.payouts where visit_id = $1`, [today])).length;
      // A clean that isn't paid has no row: next week's clean, not even done.
      const unpaid = (await q.rows(`select 1 from public.payouts where visit_id = $1`, [IDS.visitNextWeek])).length;
      return { after, unpaid };
    });
    expect(r).toEqual({ after: 1, unpaid: 0 });
  });

  it("with no check period set, writes nothing (the team's settings checklist says why)", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`alter table public.settings disable trigger user`);
      await q.rows(`update public.settings set dispute_window_hours = null`);
      await q.rows(`alter table public.settings enable trigger user`);
      await paid(q);
      return (await q.rows(`select 1 from public.payouts where visit_id = $1`, [today])).length;
    });
    expect(r).toBe(0);
  });
});

describe("who is due", () => {
  it("nobody inside the check period; the cleaner and the amount once it has passed", async () => {
    const r = await as("superuser", async (q) => {
      await paid(q);
      const inside = await due(q);
      await past(q);
      const after = await due(q);
      return { inside: inside.length, after: after.map((d) => [d.cleaner_id === U.tara, d.due_pence, /^acct_/.test(d.cleaner_account_id)]) };
    });
    expect(r).toEqual({ inside: 0, after: [[true, 3750, true]] });
  });

  it("not while the cleaner's Stripe account can't pay out, or once the payment no longer stands", async () => {
    const r = await as("superuser", async (q) => {
      await paid(q);
      await past(q);
      await q.rows(`update public.cleaners set stripe_payouts_enabled = false where id = $1`, [U.tara]);
      const noPayouts = (await due(q)).length;
      await q.rows(`update public.cleaners set stripe_payouts_enabled = true where id = $1`, [U.tara]);
      await q.rows(`update public.payments set status = 'disputed' where visit_id = $1`, [today]);
      const disputed = (await due(q)).length;
      const forced = await open(q, 100000);
      return { noPayouts, disputed, forced: forced.length };
    });
    expect(r).toEqual({ noPayouts: 0, disputed: 0, forced: 0 });
  });
});

describe("one bank payout", () => {
  it("takes what fits inside the money Stripe says has cleared, oldest first; nothing when nothing fits", async () => {
    const r = await as("superuser", async (q) => {
      await paid(q);
      await past(q);
      const short = await open(q, 3749);
      const still = (await row(q))!.status;
      const [b] = await open(q, 3750);
      const again = await open(q, 100000);
      return { short: short.length, still, amount: b!.amount_pence, key: b!.idempotency_key === `payout-batch:${b!.batch_id}`, row: await row(q), again: again.length, dueNow: (await due(q)).length };
    });
    expect(r).toEqual({ short: 0, still: "pending", amount: 3750, key: true,
      row: { status: "in_batch", amount_pence: 3750, hours: expect.any(Number), batch: true, po: null, paid: false }, again: 0, dueNow: 0 });
  });

  it("sent, then paid on Stripe's say-so: the clean shows paid, once", async () => {
    const r = await as("superuser", async (q) => {
      await paid(q);
      await past(q);
      const [b] = await open(q, 5000);
      const s = [await sent(q, b!.batch_id), await sent(q, b!.batch_id)];
      const transit = await result(q, b!.batch_id, "in_transit");
      const first = await result(q, b!.batch_id, "paid");
      const replay = await result(q, b!.batch_id, "paid");
      return { s, transit, first, replay, batch: await batch(q, b!.batch_id), row: await row(q) };
    });
    expect(r).toEqual({ s: ["sent", "already"], transit: "ignored", first: "paid", replay: "already",
      batch: { status: "paid", amount_pence: 3750, po: PO },
      row: { status: "paid", amount_pence: 3750, hours: expect.any(Number), batch: true, po: PO, paid: true } });
  });

  it("refuses an answer that isn't this payout's: another payout id, account or amount", async () => {
    const r = await as("superuser", async (q) => {
      await paid(q);
      await past(q);
      const [b] = await open(q, 5000);
      await sent(q, b!.batch_id);
      const out = [
        await result(q, b!.batch_id, "paid", { po: "po_TestSomeoneElse1" }),
        await result(q, b!.batch_id, "paid", { acct: "acct_TestSomeoneElse" }),
        await result(q, b!.batch_id, "paid", { amount: 3751 }),
        await result(q, "00000000-0000-4000-f100-0000000000ff", "paid"),
      ];
      return { out, status: (await batch(q, b!.batch_id))!.status, alerts: await alerts(q) };
    });
    expect(r).toEqual({ out: ["mismatch", "mismatch", "mismatch", "unknown"], status: "created", alerts: ["payout_stuck"] });
  });

  it("a request Stripe refused puts the earnings straight back to waiting; uncleared money is quiet, anything else tells the team", async () => {
    const r = await as("superuser", async (q) => {
      await paid(q);
      await past(q);
      const [a] = await open(q, 5000);
      await server(q);
      const [{ r: first }] = await q.rows<{ r: string }>(`select public.payout_batch_not_sent($1, 'stripe_balance_insufficient') as r`, [a!.batch_id]) as [{ r: string }];
      await su(q);
      const quiet = await alerts(q);
      const back = (await row(q))!;
      const [b] = await open(q, 5000);
      await server(q);
      await q.rows(`select public.payout_batch_not_sent($1, 'stripe_account_invalid')`, [b!.batch_id]);
      await su(q);
      return { first, quiet, back: [back.status, back.batch], newBatch: b!.batch_id !== a!.batch_id, loud: await alerts(q), old: (await batch(q, a!.batch_id))!.status };
    });
    expect(r).toEqual({ first: "returned", quiet: [], back: ["pending", false], newBatch: true, loud: ["payout_failed"], old: "failed" });
  });
});

describe("a bank that says no", () => {
  it("marks the cleans failed and tells the team; tried again only after Stripe reports the account changed", async () => {
    const r = await as("superuser", async (q) => {
      await paid(q);
      await past(q);
      const [b] = await open(q, 5000);
      await sent(q, b!.batch_id);
      const said = await result(q, b!.batch_id, "failed", { error: "account_closed" });
      const failed = (await row(q))!.status;
      const before = (await due(q)).length;
      await q.rows(`update public.cleaners set stripe_status_at = clock_timestamp() + interval '1 second' where id = $1`, [U.tara]);
      const after = (await due(q)).length;
      const [again] = await open(q, 5000);
      return { said, failed, alerts: await alerts(q), before, after, retried: again!.amount_pence, row: (await row(q))!.status };
    });
    expect(r).toEqual({ said: "failed", failed: "failed", alerts: ["payout_failed"], before: 0, after: 1, retried: 3750, row: "in_batch" });
  });

  it("a payout sent back after it showed as paid: the team is told, the cleans stay as they were", async () => {
    const r = await as("superuser", async (q) => {
      await paid(q);
      await past(q);
      const [b] = await open(q, 5000);
      await sent(q, b!.batch_id);
      await result(q, b!.batch_id, "paid");
      const late = await result(q, b!.batch_id, "failed", { error: "could_not_process" });
      return { late, batch: (await batch(q, b!.batch_id))!.status, row: (await row(q))!.status, alerts: await alerts(q) };
    });
    expect(r).toEqual({ late: "failed", batch: "failed", row: "paid", alerts: ["payout_failed"] });
  });
});

describe("chasing answers", () => {
  it("lists a payout never sent (send again) or sent and unanswered (ask Stripe); flags one stuck for a day", async () => {
    const r = await as("superuser", async (q) => {
      await paid(q);
      await past(q);
      const [b] = await open(q, 5000);
      const list = async () => { await server(q); const x = await q.rows<{ batch_id: string; mode: string }>(`select batch_id, mode from public.payout_batches_open()`); await su(q); return x.filter((y) => y.batch_id === b!.batch_id).map((y) => y.mode); };
      const fresh = await list();
      await q.rows(`alter table public.payout_batches disable trigger user`);
      await q.rows(`update public.payout_batches set created_at = now() - interval '20 minutes' where id = $1`, [b!.batch_id]);
      const unsent = await list();
      await q.rows(`update public.payout_batches set created_at = now() - interval '24 hours' where id = $1`, [b!.batch_id]);
      const old = await list();
      const stuck = await alerts(q);
      await q.rows(`update public.payout_batches set stripe_payout_id = $2, sent_at = now() - interval '40 minutes' where id = $1`, [b!.batch_id, PO]);
      await q.rows(`alter table public.payout_batches enable trigger user`);
      const unanswered = await list();
      return { fresh, unsent, old, stuck, unanswered };
    });
    expect(r).toEqual({ fresh: [], unsent: ["send"], old: [], stuck: ["payout_stuck"], unanswered: ["check"] });
  });
});

describe("who may do what", () => {
  it("only the server can run any of it", async () => {
    const calls = [
      `select * from public.payout_due_cleaners()`,
      `select * from public.payout_batch_open('${U.tara}', 100000)`,
      `select public.payout_batch_sent(gen_random_uuid(), 'po_TestX0000001', current_date)`,
      `select public.payout_batch_not_sent(gen_random_uuid(), 'x')`,
      `select * from public.payout_batches_open()`,
      `select public.stripe_payout_result(gen_random_uuid(), 'po_TestX0000001', 'acct_TestX000001', 'paid', 1, current_date, null)`,
    ];
    for (const who of ["tara", "anna", "admin", "anon"] as const) {
      for (const sql of calls) expect({ who, sql, code: await as(who, (q) => q.attempt(sql)) }).toEqual({ who, sql, code: "42501" });
    }
  });

  it("a cleaner sees their own earnings and bank payouts, never a Stripe id; nobody else's", async () => {
    const r = await as("superuser", async (q) => {
      await paid(q);
      await past(q);
      const [b] = await open(q, 5000);
      await sent(q, b!.batch_id);
      await q.actAs(U.tara);
      const mine = (await q.rows(`select id, status, amount_pence, available_after from public.payouts where visit_id = $1`, [today])).length;
      const myBatch = (await q.rows(`select id, status, amount_pence, arrival_date from public.payout_batches where id = $1`, [b!.batch_id])).length;
      const ids = [await q.attempt(`select stripe_payout_id from public.payout_batches`), await q.attempt(`select idempotency_key from public.payout_batches`),
        await q.attempt(`select failure_reason from public.payout_batches`), await q.attempt(`select stripe_payout_id from public.payouts`)];
      await q.actAs(U.alex);
      const others = [(await q.rows(`select id from public.payouts`)).length, (await q.rows(`select id from public.payout_batches`)).length];
      await q.actAs(U.anna);
      const customer = [(await q.rows(`select id from public.payouts`)).length, (await q.rows(`select id from public.payout_batches`)).length];
      return { mine, myBatch, ids, others, customer };
    });
    expect(r).toEqual({ mine: 1, myBatch: 1, ids: ["42501", "42501", "42501", "42501"], others: [0, 0], customer: [0, 0] });
  });

  it("the cron kick does nothing when nothing is due, or when the job address isn't set up", async () => {
    const r = await as("superuser", async (q) => {
      const nothing = (await q.rows<{ r: string }>(`select private.kick_payout_job() as r`))[0]!.r;
      await paid(q);
      await past(q);
      const [b] = await open(q, 5000);
      await q.rows(`alter table public.payout_batches disable trigger user`);
      await q.rows(`update public.payout_batches set created_at = now() - interval '20 minutes' where id = $1`, [b!.batch_id]);
      await q.rows(`alter table public.payout_batches enable trigger user`);
      return { nothing, due: (await q.rows<{ r: string }>(`select private.kick_payout_job() as r`))[0]!.r };
    });
    expect(r).toEqual({ nothing: "nothing_due", due: "not_set_up" });
  });
});
