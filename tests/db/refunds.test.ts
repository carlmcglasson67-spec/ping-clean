// Payments PR 10: refunds and chargebacks.
import { afterAll, describe, expect, it } from "vitest";
import { as, IDS, pool, U, type Query } from "./helpers";

afterAll(() => pool.end());

const today = IDS.visitToday; // Anna's clean today, Tara's (seed): £50 = £37.50 Tara + £12.50 Ping
const PI = "pi_TestRefund00001";
const RE = "re_TestRefund00001";
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
  await q.rows(`select public.stripe_payment_result($1, $2, 'succeeded', $3, $4, $5, 'ch_TestRefund0001', null, null)`,
    [p!.id, PI, p!.amount_pence, p!.application_fee_pence, p!.cleaner_account_id]);
  await su(q);
  return p!.id;
}
const ask = async (q: Query, payment: string, pence: number, reason: string, note: string | null = null) => {
  await q.actAs(U.admin);
  const r = await q.rows<{ id: string }>(`select public.admin_refund($1, $2, $3, $4) as id`, [payment, pence, reason, note]);
  await su(q);
  return r[0]!.id;
};
const tryAsk = async (q: Query, who: string, payment: string, pence: number, reason: string) => {
  await q.actAs(who);
  const code = await q.attempt(`select public.admin_refund($1, $2, $3, null)`, [payment, pence, reason]);
  await su(q);
  return code;
};
const said = async (q: Query, refund: string, outcome: string, over: { re?: string | null; amount?: number; error?: string; pi?: string } = {}) => {
  const [r] = await q.rows<{ amount_pence: number }>(`select amount_pence from public.refunds where id = $1`, [refund]);
  await server(q);
  const x = await q.rows<{ r: string }>(`select public.stripe_refund_result($1, $2, $3, $4, $5, $6) as r`,
    [refund, over.re === undefined ? RE : over.re, outcome, over.amount ?? r?.amount_pence ?? 0, over.error ?? null, over.pi ?? null]);
  await su(q);
  return x[0]!.r;
};
const refund = async (q: Query, id: string) => (await q.rows<{ status: string; amount_pence: number; cleaner_part_pence: number; ping_part_pence: number; re: string | null }>(
  `select status, amount_pence, cleaner_part_pence, ping_part_pence, stripe_refund_id as re from public.refunds where id = $1`, [id]))[0]!;
const payment = async (q: Query, id: string) => (await q.rows<{ status: string; refunded_pence: number }>(`select status::text, refunded_pence from public.payments where id = $1`, [id]))[0]!;
const payout = async (q: Query) => (await q.rows<{ status: string; amount_pence: number; held_reason: string | null }>(`select status::text, amount_pence, held_reason from public.payouts where visit_id = $1`, [today]))[0]!;
const alerts = async (q: Query) => (await q.rows<{ kind: string }>(
  `select kind from public.engine_alerts where kind in ('refund_failed', 'refund_after_payout', 'payment_disputed') and resolved_at is null order by kind`)).map((a) => a.kind);
const dispute = async (q: Query, outcome: string, pi = PI) => { await server(q); const x = await q.rows<{ r: string }>(`select public.stripe_dispute($1, $2) as r`, [pi, outcome]); await su(q); return x[0]!.r; };
const due = async (q: Query) => {
  await q.rows(`update public.payouts set available_after = now() - interval '1 minute' where visit_id = $1 and status = 'pending'`, [today]);
  await server(q);
  const r = await q.rows<{ due_pence: number }>(`select due_pence from public.payout_due_cleaners() where cleaner_id = $1`, [U.tara]);
  await su(q);
  return r[0]?.due_pence ?? 0;
};

describe("who carries a refund", () => {
  it("the clean wasn't right: the cleaner and Ping share it as the clean was split, to the penny", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      const a = await refund(q, await ask(q, p, 1000, "clean_quality"));
      return { a: [a.cleaner_part_pence, a.ping_part_pence, a.status], held: await payout(q) };
    });
    // £10 of a £50 clean split £37.50 / £12.50: £7.50 from the cleaner, £2.50 from Ping.
    expect(r).toEqual({ a: [750, 250, "pending"], held: { status: "held", amount_pence: 3750, held_reason: "refund_pending" } });
  });

  it("an awkward amount still adds up, and nothing is ever a fraction of a penny", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      const a = await refund(q, await ask(q, p, 333, "no_show"));
      return [a.cleaner_part_pence, a.ping_part_pence, a.cleaner_part_pence + a.ping_part_pence];
    });
    expect(r).toEqual([250, 83, 333]); // 333 × 1250 ÷ 5000 = 83.25 → 83p Ping, the rest the cleaner
  });

  it.each(["ping_error", "goodwill", "other"])("%s: Ping carries all of it and the cleaner's earnings aren't touched", async (reason) => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      const id = await ask(q, p, 5000, reason, "Called the customer, agreed a full refund");
      const a = await refund(q, id);
      const before = await payout(q);
      const result = await said(q, id, "succeeded");
      return { parts: [a.cleaner_part_pence, a.ping_part_pence], before: before.status, result, payment: await payment(q, p), payout: await payout(q), stillDue: await due(q) };
    });
    // Refunded in full out of Ping's pocket: the cleaner is still paid in full.
    expect(r).toEqual({ parts: [0, 5000], before: "pending", result: "succeeded", payment: { status: "refunded", refunded_pence: 5000 },
      payout: { status: "pending", amount_pence: 3750, held_reason: null }, stillDue: 3750 });
  });
});

describe("a shared refund before the cleaner is paid", () => {
  it("part: the payment shows part refunded and the cleaner's earnings drop by exactly their part, then carry on", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      const id = await ask(q, p, 1000, "clean_quality");
      const whileHeld = await due(q);
      const result = [await said(q, id, "succeeded"), await said(q, id, "succeeded")]; // the webhook repeats it
      return { whileHeld, result, refund: (await refund(q, id)).status, payment: await payment(q, p), payout: await payout(q), due: await due(q) };
    });
    expect(r).toEqual({ whileHeld: 0, result: ["succeeded", "already"], refund: "succeeded", payment: { status: "partially_refunded", refunded_pence: 1000 },
      payout: { status: "pending", amount_pence: 3000, held_reason: null }, due: 3000 });
  });

  it("two part refunds, one shared and one Ping's: every pound is accounted for", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      const a = await ask(q, p, 2000, "clean_quality"); // 1500 cleaner, 500 Ping
      await said(q, a, "succeeded", { re: "re_TestRefund0000A" });
      const b = await ask(q, p, 1000, "goodwill"); // all Ping
      await said(q, b, "succeeded", { re: "re_TestRefund0000B" });
      const [sum] = await q.rows<{ c: number; g: number }>(`select sum(cleaner_part_pence)::int as c, sum(ping_part_pence)::int as g from public.refunds where payment_id = $1 and status = 'succeeded'`, [p]);
      return { payment: await payment(q, p), payout: (await payout(q)).amount_pence, sum };
    });
    // £50 paid, £30 refunded: the cleaner keeps 3750 − 1500 = 2250.
    expect(r).toEqual({ payment: { status: "partially_refunded", refunded_pence: 3000 }, payout: 2250, sum: { c: 1500, g: 1500 } });
  });

  it("in full: the payment shows refunded and the cleaner's earnings for the clean are cancelled", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      const id = await ask(q, p, 5000, "no_show");
      const parts = await refund(q, id);
      await said(q, id, "succeeded");
      return { parts: [parts.cleaner_part_pence, parts.ping_part_pence], payment: await payment(q, p), payout: (await payout(q)).status, due: await due(q) };
    });
    expect(r).toEqual({ parts: [3750, 1250], payment: { status: "refunded", refunded_pence: 5000 }, payout: "cancelled", due: 0 });
  });

  it("Stripe says no: nothing changes on the payment, the earnings are released and the team is told", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      const id = await ask(q, p, 1000, "clean_quality");
      const result = await said(q, id, "failed", { re: null, error: "charge_already_refunded" });
      const again = await tryAsk(q, U.admin, p, 1000, "clean_quality"); // and it can be tried again
      return { result, refund: (await refund(q, id)).status, payment: await payment(q, p), alerts: await alerts(q), again };
    });
    expect(r).toEqual({ result: "failed", refund: "failed", payment: { status: "succeeded", refunded_pence: 0 }, alerts: ["refund_failed"], again: "ok" });
  });
});

describe("a shared refund after the cleaner was paid", () => {
  it("leaves their paid earnings as they were and tells the team it comes from their next earnings", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      await q.rows(`update public.payouts set available_after = now() - interval '1 minute' where visit_id = $1`, [today]);
      await server(q);
      const [b] = await q.rows<{ batch_id: string }>(`select batch_id from public.payout_batch_open($1, 5000)`, [U.tara]);
      await q.rows(`select public.payout_batch_sent($1, 'po_TestRefund00001', current_date + 2)`, [b!.batch_id]);
      await q.rows(`select public.stripe_payout_result($1, 'po_TestRefund00001', (select stripe_account_id from public.cleaners where id = $2), 'paid', 3750, current_date, null)`, [b!.batch_id, U.tara]);
      await su(q);
      const id = await ask(q, p, 1000, "clean_quality");
      await said(q, id, "succeeded");
      const [a] = await q.rows<{ message: string }>(`select message from public.engine_alerts where kind = 'refund_after_payout'`);
      return { payout: await payout(q), payment: (await payment(q, p)).status, alerts: await alerts(q), says: /£7\.50/.test(a!.message) };
    });
    expect(r).toEqual({ payout: { status: "paid", amount_pence: 3750, held_reason: null }, payment: "partially_refunded", alerts: ["refund_after_payout"], says: true });
  });
});

describe("what can't be refunded", () => {
  it("more than is left, nothing, a second while one is on its way, an unpaid payment, or with no reason", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      const out: Record<string, string> = {
        tooMuch: await tryAsk(q, U.admin, p, 5001, "goodwill"),
        zero: await tryAsk(q, U.admin, p, 0, "goodwill"),
        noReason: await tryAsk(q, U.admin, p, 100, "because"),
      };
      const first = await ask(q, p, 4000, "goodwill");
      out.second = await tryAsk(q, U.admin, p, 100, "goodwill");
      await said(q, first, "succeeded");
      out.moreThanLeft = await tryAsk(q, U.admin, p, 1001, "goodwill");
      out.theRest = await tryAsk(q, U.admin, p, 1000, "goodwill");
      const [seeded] = await q.rows<{ id: string }>(`select id from public.payments where status = 'succeeded' and stripe_payment_intent_id is null limit 1`);
      out.neverCharged = seeded ? await tryAsk(q, U.admin, seeded.id, 100, "goodwill") : "PC048";
      return out;
    });
    expect(r).toEqual({ tooMuch: "PC042", zero: "PC042", noReason: "PC049", second: "PC049", moreThanLeft: "PC042", theRest: "ok", neverCharged: "PC048" });
  });

  it("a clean's payment isn't a fee to waive", async () => {
    const r = await as("superuser", async (q) => tryAsk(q, U.admin, await paid(q), 500, "fee_waived"));
    expect(r).toBe("PC036");
  });

  it("only the Ping team can ask; nobody but the server can send or settle one", async () => {
    const p = await as("superuser", async (q) => { const id = await paid(q); return id; }).catch(() => null);
    expect(p).not.toBeNull();
    const r = await as("superuser", async (q) => {
      const id = await paid(q);
      const out: Record<string, string> = {};
      for (const [name, who] of [["cleaner", U.tara], ["customer", U.anna], ["otherCleaner", U.alex]] as const) out[name] = await tryAsk(q, who, id, 100, "goodwill");
      const calls = [`select * from public.refund_to_send(gen_random_uuid())`, `select * from public.refunds_open()`,
        `select public.stripe_refund_result(gen_random_uuid(), 're_TestX0000001', 'succeeded', 1, null)`, `select public.stripe_dispute('pi_TestX0000001', 'opened')`];
      for (const who of [U.tara, U.anna, U.admin]) {
        await q.actAs(who);
        for (const sql of calls) out[`${who.slice(-1)}:${sql.slice(7, 40)}`] = await q.attempt(sql);
        await su(q);
      }
      return out;
    });
    expect(new Set(Object.values(r))).toEqual(new Set(["42501"]));
  });

  it("an answer that isn't this refund's changes nothing and raises the alarm", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      const id = await ask(q, p, 1000, "clean_quality");
      await said(q, id, "pending");
      const out = [await said(q, id, "succeeded", { re: "re_TestSomeoneElse1" }), await said(q, id, "succeeded", { amount: 5000 }),
        await said(q, id, "succeeded", { pi: "pi_TestAnotherOne001" }), await said(q, "00000000-0000-4000-f300-0000000000ff", "succeeded")];
      return { out, refund: await refund(q, id), payment: await payment(q, p), alerts: await alerts(q) };
    });
    expect(r).toEqual({ out: ["mismatch", "mismatch", "mismatch", "unknown"], refund: { status: "pending", amount_pence: 1000, cleaner_part_pence: 750, ping_part_pence: 250, re: RE },
      payment: { status: "succeeded", refunded_pence: 0 }, alerts: ["refund_failed"] });
  });
});

describe("sending and chasing", () => {
  it("gives the server what to send; lists one that never reached Stripe; flags one stuck for a day", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      const id = await ask(q, p, 1000, "clean_quality");
      await server(q);
      const [send] = await q.rows<{ payment_intent_id: string; amount_pence: number; shared: boolean; idempotency_key: string }>(`select payment_intent_id, amount_pence, shared, idempotency_key from public.refund_to_send($1)`, [id]);
      const list = async () => { await server(q); const x = await q.rows<{ mode: string }>(`select mode from public.refunds_open()`); await su(q); return x.map((y) => y.mode); };
      const fresh = await list();
      await q.rows(`alter table public.refunds disable trigger user`);
      await q.rows(`update public.refunds set created_at = now() - interval '20 minutes' where id = $1`, [id]);
      const unsent = await list();
      const kick = (await q.rows<{ due: boolean }>(`select private.payouts_due() as due`))[0]!.due;
      await q.rows(`update public.refunds set created_at = now() - interval '24 hours' where id = $1`, [id]);
      await q.rows(`alter table public.refunds enable trigger user`);
      const old = await list();
      return { send: { ...send, idempotency_key: send!.idempotency_key === `refund:${id}` }, fresh, unsent, kick, old, alerts: await alerts(q) };
    });
    expect(r).toEqual({ send: { payment_intent_id: PI, amount_pence: 1000, shared: true, idempotency_key: true }, fresh: [], unsent: ["send"], kick: true, old: [], alerts: ["refund_failed"] });
  });

  it("asks Stripe about a refund it has had for over an hour without an answer", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      const id = await ask(q, p, 1000, "clean_quality");
      await said(q, id, "pending"); // Stripe took it and is still working on it
      const list = async () => { await server(q); const x = await q.rows<{ mode: string; stripe_refund_id: string }>(`select mode, stripe_refund_id from public.refunds_open()`); await su(q); return x; };
      const soon = await list();
      await q.rows(`alter table public.refunds disable trigger user`);
      await q.rows(`update public.refunds set updated_at = now() - interval '61 minutes' where id = $1`, [id]);
      await q.rows(`alter table public.refunds enable trigger user`);
      const kick = (await q.rows<{ due: boolean }>(`select private.payouts_due() as due`))[0]!.due;
      const later = await list();
      await said(q, id, "pending"); // asked, still going: not asked again for an hour
      return { soon: soon.length, kick, later, again: (await list()).length };
    });
    expect(r).toEqual({ soon: 0, kick: true, later: [{ mode: "check", stripe_refund_id: RE }], again: 0 });
  });
});

describe("chargebacks", () => {
  it("opened: the payment shows disputed, the cleaner's unpaid earnings are held, the team gets one alert", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      const said2 = [await dispute(q, "opened"), await dispute(q, "opened"), await dispute(q, "opened", "pi_TestNobodys0001")];
      return { said2, payment: (await payment(q, p)).status, payout: await payout(q), alerts: await alerts(q), due: await due(q), refund: await tryAsk(q, U.admin, p, 100, "goodwill") };
    });
    expect(r).toEqual({ said2: ["disputed", "already", "unknown"], payment: "disputed", payout: { status: "held", amount_pence: 3750, held_reason: "dispute_open" },
      alerts: ["payment_disputed"], due: 0, refund: "PC048" });
  });

  it("won: the payment stands again and the earnings are released", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      await dispute(q, "opened");
      const won = await dispute(q, "won");
      return { won, payment: (await payment(q, p)).status, payout: await payout(q), alerts: await alerts(q), due: await due(q) };
    });
    expect(r).toEqual({ won: "won", payment: "succeeded", payout: { status: "pending", amount_pence: 3750, held_reason: null }, alerts: [], due: 3750 });
  });

  it("lost: the payment shows lost, the unpaid earnings are cancelled and the team is told what's left to do", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      await dispute(q, "opened");
      const lost = [await dispute(q, "lost"), await dispute(q, "lost"), await dispute(q, "won")];
      const [a] = await q.rows<{ message: string }>(`select message from public.engine_alerts where kind = 'payment_disputed' and resolved_at is null`);
      return { lost, payment: (await payment(q, p)).status, payout: (await payout(q)).status, alerts: await alerts(q), says: /reverse the transfer/.test(a!.message) };
    });
    expect(r).toEqual({ lost: ["lost", "already", "already"], payment: "dispute_lost", payout: "cancelled", alerts: ["payment_disputed"], says: true });
  });

  it("a dispute on a part-refunded payment that's won goes back to part refunded", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      const id = await ask(q, p, 1000, "clean_quality");
      await said(q, id, "succeeded");
      await dispute(q, "opened");
      await dispute(q, "won");
      return { payment: await payment(q, p), payout: await payout(q) };
    });
    expect(r).toEqual({ payment: { status: "partially_refunded", refunded_pence: 1000 }, payout: { status: "pending", amount_pence: 3000, held_reason: null } });
  });
});

/** Tara's earnings for the clean are past their check period and in a bank payout Stripe has taken. */
async function withTheBank(q: Query) {
  await q.rows(`update public.payouts set available_after = now() - interval '1 minute' where visit_id = $1`, [today]);
  await server(q);
  const [b] = await q.rows<{ batch_id: string }>(`select batch_id from public.payout_batch_open($1, 5000)`, [U.tara]);
  await su(q);
  return b!.batch_id;
}
const bankSaysNo = async (q: Query, batch: string) => {
  await server(q);
  await q.rows(`select public.payout_batch_sent($1, 'po_TestRefund00002', current_date + 2)`, [batch]);
  await q.rows(`select public.stripe_payout_result($1, 'po_TestRefund00002', (select stripe_account_id from public.cleaners where id = $2), 'failed', 3750, current_date, 'account_closed')`, [batch, U.tara]);
  await su(q);
};
/** A day on, and Stripe says the cleaner's account has changed: bank-refused earnings are due again. */
const cleanerFixedTheirBank = async (q: Query) => {
  await q.rows(`alter table public.payout_batches disable trigger user`);
  await q.rows(`update public.payout_batches set created_at = created_at - interval '21 hours' where cleaner_id = $1`, [U.tara]);
  await q.rows(`alter table public.payout_batches enable trigger user`);
  await q.rows(`update public.cleaners set stripe_status_at = now() + interval '2 hours' where id = $1`, [U.tara]);
};
const openBatch = async (q: Query) => { await server(q); const x = await q.rows<{ amount_pence: number }>(`select amount_pence from public.payout_batch_open($1, 5000)`, [U.tara]); await su(q); return x[0]?.amount_pence ?? null; };

describe("a cleaner's earnings always end on the right figure (review finding 1)", () => {
  it("the bank had refused their payout, then a shared refund: reduced, and paid at the reduced figure once they fix their bank", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      await bankSaysNo(q, await withTheBank(q));
      const id = await ask(q, p, 1000, "clean_quality");
      await said(q, id, "succeeded");
      const after = await payout(q);
      await cleanerFixedTheirBank(q);
      return { after, batch: await openBatch(q), row: await payout(q), alerts: await alerts(q) };
    });
    expect(r).toEqual({ after: { status: "failed", amount_pence: 3000, held_reason: null }, batch: 3000, row: { status: "in_batch", amount_pence: 3000, held_reason: null }, alerts: [] });
  });

  it("the same, refunded in full: their row is cancelled, and nothing stops their other earnings", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      await bankSaysNo(q, await withTheBank(q));
      const id = await ask(q, p, 5000, "no_show");
      await said(q, id, "succeeded");
      await cleanerFixedTheirBank(q);
      return { row: (await payout(q)).status, batch: await openBatch(q) };
    });
    expect(r).toEqual({ row: "cancelled", batch: null });
  });

  it("a refund lands while their pay is in a bank payout that Stripe then refuses to take: it comes back reduced", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      const batch = await withTheBank(q);
      const id = await ask(q, p, 1000, "clean_quality");
      await said(q, id, "succeeded");
      const during = await payout(q);
      await server(q);
      await q.rows(`select public.payout_batch_not_sent($1, 'stripe_balance_insufficient')`, [batch]);
      await su(q);
      const back = await payout(q);
      await cleanerFixedTheirBank(q);
      return { during, back, batch: await openBatch(q), alerts: await alerts(q) };
    });
    expect(r).toEqual({ during: { status: "in_batch", amount_pence: 3750, held_reason: null }, back: { status: "pending", amount_pence: 3000, held_reason: null },
      batch: 3000, alerts: ["refund_after_payout"] });
  });

  it("Stripe takes a refund back after saying it had gone: their earnings are restored and held for a person, not sent", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      const id = await ask(q, p, 1000, "clean_quality");
      await said(q, id, "succeeded");
      const reduced = (await payout(q)).amount_pence;
      const late = await said(q, id, "failed", { error: "expired_or_canceled_card" });
      return { reduced, late, row: await payout(q), due: await due(q), alerts: await alerts(q) };
    });
    expect(r).toEqual({ reduced: 3000, late: "failed", row: { status: "held", amount_pence: 3750, held_reason: "admin_review" }, due: 0, alerts: ["refund_failed"] });
  });

  it("Stripe says a refund went through that Ping had recorded as failed: an alarm, and nothing changes", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      const id = await ask(q, p, 1000, "clean_quality");
      await said(q, id, "failed", { re: null, error: "unknown" });
      await q.rows(`update public.engine_alerts set resolved_at = now() where kind = 'refund_failed'`);
      const late = await said(q, id, "succeeded");
      const [a] = await q.rows<{ message: string }>(`select message from public.engine_alerts where kind = 'refund_failed' and resolved_at is null`);
      return { late, payment: await payment(q, p), refund: (await refund(q, id)).status, says: /do NOT refund it again/.test(a?.message ?? "") };
    });
    expect(r).toEqual({ late: "already", payment: { status: "succeeded", refunded_pence: 0 }, refund: "failed", says: true });
  });
});

describe("a refund settling while a chargeback is open (review finding 2)", () => {
  it("part refund: the payment stays disputed, the chargeback's outcome is still recorded, and the earnings end right", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      const id = await ask(q, p, 1000, "clean_quality");
      await dispute(q, "opened");
      const settled = await said(q, id, "succeeded");
      const during = { payment: await payment(q, p), payout: await payout(q), due: await due(q), more: await tryAsk(q, U.admin, p, 100, "goodwill") };
      const won = await dispute(q, "won");
      return { settled, during, won, payment: await payment(q, p), payout: await payout(q), alerts: await alerts(q) };
    });
    expect(r).toEqual({ settled: "succeeded",
      during: { payment: { status: "disputed", refunded_pence: 1000 }, payout: { status: "held", amount_pence: 3000, held_reason: "dispute_open" }, due: 0, more: "PC048" },
      won: "won", payment: { status: "partially_refunded", refunded_pence: 1000 }, payout: { status: "pending", amount_pence: 3000, held_reason: null }, alerts: [] });
  });

  it("the same chargeback lost: recorded as lost and the earnings cancelled", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      const id = await ask(q, p, 1000, "clean_quality");
      await dispute(q, "opened");
      await said(q, id, "succeeded");
      const lost = await dispute(q, "lost");
      return { lost, payment: (await payment(q, p)).status, payout: (await payout(q)).status };
    });
    expect(r).toEqual({ lost: "lost", payment: "dispute_lost", payout: "cancelled" });
  });

  it("refunded in full by Ping during the dispute, then won: the payment ends refunded and the cleaner is still paid", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      const id = await ask(q, p, 5000, "goodwill");
      await dispute(q, "opened");
      const settled = await said(q, id, "succeeded");
      const during = await payment(q, p);
      const won = await dispute(q, "won");
      return { settled, during, won, payment: await payment(q, p), payout: await payout(q), due: await due(q) };
    });
    expect(r).toEqual({ settled: "succeeded", during: { status: "disputed", refunded_pence: 5000 }, won: "won",
      payment: { status: "refunded", refunded_pence: 5000 }, payout: { status: "pending", amount_pence: 3750, held_reason: null }, due: 3750 });
  });

  it("earnings the bank had sent back are held too, so nothing goes out while it's open", async () => {
    const r = await as("superuser", async (q) => {
      await paid(q);
      await bankSaysNo(q, await withTheBank(q));
      await dispute(q, "opened");
      const held = await payout(q);
      await cleanerFixedTheirBank(q);
      return { held, batch: await openBatch(q) };
    });
    expect(r).toEqual({ held: { status: "held", amount_pence: 3750, held_reason: "dispute_open" }, batch: null });
  });

  it("an 'opened' that arrives after its own 'closed' does nothing; one on a refunded payment tells the team", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      await dispute(q, "opened");
      await dispute(q, "won");
      const late = await dispute(q, "opened");
      const after = { payment: (await payment(q, p)).status, payout: (await payout(q)).status };
      return { late, after };
    });
    expect(r).toEqual({ late: "already", after: { payment: "succeeded", payout: "pending" } });
    const refunded = await as("superuser", async (q) => {
      const p = await paid(q);
      await said(q, await ask(q, p, 5000, "goodwill"), "succeeded");
      return { said: await dispute(q, "opened"), payment: (await payment(q, p)).status, alerts: await alerts(q) };
    });
    expect(refunded).toEqual({ said: "already", payment: "refunded", alerts: ["payment_disputed"] });
  });
});

describe("who sees what", () => {
  it("the customer sees their refund's amount and state; the cleaner sees neither the refund nor the team's note", async () => {
    const r = await as("superuser", async (q) => {
      const p = await paid(q);
      const id = await ask(q, p, 1000, "clean_quality", "Customer rang: oven not done");
      await said(q, id, "succeeded");
      await q.actAs(U.anna);
      const customer = await q.rows(`select amount_pence, status from public.refunds where id = $1`, [id]);
      const note = await q.attempt(`select note from public.refunds where id = $1`, [id]);
      await q.actAs(U.tara);
      const cleaner = (await q.rows(`select id from public.refunds`)).length;
      await q.actAs(U.ben);
      const other = (await q.rows(`select id from public.refunds`)).length;
      return { customer, note, cleaner, other };
    });
    expect(r).toEqual({ customer: [{ amount_pence: 1000, status: "succeeded" }], note: "42501", cleaner: 0, other: 0 });
  });
});
