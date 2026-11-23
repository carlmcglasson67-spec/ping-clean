// No access: the cleaner turned up and couldn't get in. The office settles the missed clean as
// "Couldn't get in" (admin_settle_visit 'no_access'); settings.no_access_rule says what it
// costs. Carl's rule (23 Nov 2026): the late-cancellation fee, split as for a late cancel.
// Plan: intent/no-access/plan.md.
import { afterAll, describe, expect, it } from "vitest";
import { as, DENIED, IDS, pool, U, type Query } from "./helpers";

afterAll(() => pool.end());

const clean = IDS.visitToday; // Anna's clean, Tara's (seed): £50.00 = £37.50 Tara + £12.50 Ping. Moved to yesterday.
const SETTLE = `select public.admin_settle_visit($1, 'no_access', $2, $3, $4, $5)`;
const QUOTE = `select rule, fee_pence, cleaner_pence, ping_pence from public.admin_no_access_quote($1)`;
const WHY = "Tara knocked and rang; nobody was in and there was no key in the safe.";

const su = (q: Query) => q.rows(`reset role`);
const server = async (q: Query) => { await q.rows(`reset role`); await q.rows(`set local role service_role`); };

/** Carl's settings, written straight in (the settings form has its own tests). */
async function rules(q: Query, s: { rule?: string | null; fee?: number | null; split?: "same_as_clean" | "fixed_share" | null; bps?: number | null }) {
  await q.rows(`alter table public.settings disable trigger user`);
  if ("rule" in s) await q.rows(`update public.settings set no_access_rule = $1`, [s.rule]);
  if ("fee" in s) await q.rows(`update public.settings set late_cancel_fee_pence = $1`, [s.fee]);
  if ("split" in s) await q.rows(`update public.settings set late_cancel_split = $1, late_cancel_cleaner_share_bps = $2`, [s.split, s.split === "fixed_share" ? s.bps : null]);
  await q.rows(`alter table public.settings enable trigger user`);
}

/** Yesterday's clean, as the night's job leaves it: missed (or started and never finished). */
async function missed(q: Query, how: "missed" | "unfinished" = "missed") {
  await q.rows(`update public.visits set scheduled_date = private.london_today() - 1 where id = $1`, [clean]);
  if (how === "unfinished") await q.rows(`update public.visits set status = 'in_progress', started_at = now() - interval '1 day' where id = $1`, [clean]);
  await q.rows(`select private.close_stale_visits()`);
}
async function quote(q: Query) {
  await q.actAs(U.admin);
  const r = await q.rows<{ rule: string; fee_pence: number; cleaner_pence: number; ping_pence: number }>(QUOTE, [clean]);
  await su(q);
  return r[0]!;
}
async function settle(q: Query, fee: number | null, charge: boolean | null = null, wasNotDone = false) {
  await q.actAs(U.admin);
  const code = await q.attempt(SETTLE, [clean, WHY, wasNotDone, fee, charge]);
  await su(q);
  return code;
}
const visit = async (q: Query) => (await q.rows<{ status: string; cancel_reason: string | null; cancelled_by: string | null; cancelled: boolean; late_cancel_fee_pence: number }>(
  `select status::text, cancel_reason, cancelled_by, cancelled_at is not null as cancelled, late_cancel_fee_pence from public.visits where id = $1`, [clean]))[0]!;
const payments = (q: Query) => q.rows<{ kind: string; status: string; amount_pence: number; cleaner_amount_pence: number; application_fee_pence: number; customer_id: string }>(
  `select kind, status::text, amount_pence, cleaner_amount_pence, application_fee_pence, customer_id from public.payments where visit_id = $1`, [clean]);
const notices = (q: Query) => q.rows<{ kind: string; customer_id: string; payment: boolean; visit_id: string }>(
  `select kind, customer_id, payment_id is not null as payment, visit_id from private.customer_notices where visit_id = $1`, [clean]);
const record = (q: Query) => q.rows<{ outcome: string; was_status: string }>(
  `select outcome, was_status::text from public.visit_settlements where visit_id = $1 order by created_at`, [clean]);
const alerts = (q: Query) => q.rows<{ kind: string; open: boolean }>(
  `select kind, resolved_at is null as open from public.engine_alerts where visit_id = $1 order by kind`, [clean]);

describe("what no access costs, from settings.no_access_rule", () => {
  it("the late-cancellation fee: the fee, split as a clean, in whole pence that add up", async () => {
    const r = await as("superuser", async (q) => {
      await missed(q);
      await rules(q, { rule: "late_cancel_fee", fee: 1500, split: "same_as_clean" });
      return quote(q);
    });
    // £15.00 × £37.50/£50.00 = £11.25 to Tara, £3.75 to Ping.
    expect(r).toEqual({ rule: "late_cancel_fee", fee_pence: 1500, cleaner_pence: 1125, ping_pence: 375 });
  });

  it("a fixed share rounds the cleaner's part down; the fee is never more than the clean", async () => {
    const r = await as("superuser", async (q) => {
      await missed(q);
      await rules(q, { rule: "late_cancel_fee", fee: 1500, split: "fixed_share", bps: 3333 });
      const fixed = await quote(q);
      await rules(q, { fee: 9000, split: "same_as_clean" });
      const capped = await quote(q);
      return { fixed, capped };
    });
    expect(r.fixed).toEqual({ rule: "late_cancel_fee", fee_pence: 1500, cleaner_pence: 499, ping_pence: 1001 });
    expect(r.capped).toEqual({ rule: "late_cancel_fee", fee_pence: 5000, cleaner_pence: 3750, ping_pence: 1250 });
  });

  it("no charge is nothing; decide each time offers the fee", async () => {
    const r = await as("superuser", async (q) => {
      await missed(q);
      await rules(q, { rule: "no_charge", fee: null });
      const none = await quote(q);
      await rules(q, { rule: "admin_decides", fee: 1500, split: "same_as_clean" });
      return { none, decide: await quote(q) };
    });
    expect(r.none).toEqual({ rule: "no_charge", fee_pence: 0, cleaner_pence: 0, ping_pence: 0 });
    expect(r.decide).toEqual({ rule: "admin_decides", fee_pence: 1500, cleaner_pence: 1125, ping_pence: 375 });
  });

  it("PC067 with no rule, or a fee rule with no fee or split set, and nothing changes", async () => {
    const r = await as("superuser", async (q) => {
      await missed(q);
      const out: Record<string, [string, string]> = {};
      const both = async (name: string) => {
        await q.actAs(U.admin);
        out[name] = [await q.attempt(QUOTE, [clean]), await q.attempt(SETTLE, [clean, WHY, false, 1500, null])];
        await su(q);
      };
      await rules(q, { rule: null });
      await both("noRule");
      await rules(q, { rule: "late_cancel_fee", fee: null });
      await both("noFee");
      await rules(q, { rule: "admin_decides", fee: 1500, split: null });
      await both("noSplit");
      return { out, status: (await visit(q)).status, payments: (await payments(q)).length, record: (await record(q)).length };
    });
    expect(r).toEqual({ out: { noRule: ["PC067", "PC067"], noFee: ["PC067", "PC067"], noSplit: ["PC067", "PC067"] }, status: "no_show", payments: 0, record: 0 });
  });

  it("the quote is for the Ping team only", async () => {
    const r = await as("superuser", async (q) => {
      await missed(q);
      const out: Record<string, string> = {};
      for (const who of ["anna", "tara", "ben"] as const) {
        await q.actAs(U[who]);
        out[who] = await q.attempt(QUOTE, [clean]);
      }
      return out;
    });
    expect(r).toEqual({ anna: DENIED, tara: DENIED, ben: DENIED });
    expect(await as("anon", (q) => q.attempt(`select * from public.admin_no_access_quote('${clean}')`))).toBe(DENIED);
  });
});

describe("couldn't get in", () => {
  it("cancels the missed clean as no access and writes the fee exactly as a late cancel would", async () => {
    const r = await as("superuser", async (q) => {
      await missed(q);
      await rules(q, { rule: "late_cancel_fee", fee: 1500, split: "same_as_clean" });
      const before = await alerts(q);
      const told = await quote(q);
      const first = await settle(q, told.fee_pence);
      const again = await settle(q, told.fee_pence);
      await q.actAs(U.admin);
      const done = await q.attempt(`select public.admin_settle_visit($1, 'done', $2)`, [clean, WHY]);
      await su(q);
      const audit = await q.rows<{ actor_id: string }>(
        `select actor_id from public.audit_log where entity = 'visits' and entity_id = $1 and detail -> 'status' ->> 'to' = 'cancelled'`, [clean]);
      return { before, first, again, done, visit: await visit(q), payments: await payments(q), notices: await notices(q),
               record: await record(q), alerts: await alerts(q), audit };
    });
    expect(r.before).toEqual([{ kind: "visit_no_show", open: true }]);
    expect(r).toMatchObject({ first: "ok", again: "PC056", done: "PC056" });
    expect(r.visit).toEqual({ status: "cancelled", cancel_reason: "no_access", cancelled_by: U.admin, cancelled: true, late_cancel_fee_pence: 1500 });
    // One payment, passing check_payment_matches_visit: the charge job's to take.
    expect(r.payments).toEqual([{ kind: "late_cancel", status: "pending", amount_pence: 1500, cleaner_amount_pence: 1125, application_fee_pence: 375, customer_id: U.anna }]);
    expect(r.notices).toEqual([{ kind: "no_access_fee", customer_id: U.anna, payment: true, visit_id: clean }]);
    expect(r.record).toEqual([{ outcome: "no_access", was_status: "no_show" }]);
    expect(r.alerts).toEqual([{ kind: "visit_no_show", open: false }]);
    expect(r.audit).toEqual([{ actor_id: U.admin }]);
  });

  it("no charge: cancelled as no access, no payment, and the customer is still told (once)", async () => {
    const r = await as("superuser", async (q) => {
      await missed(q);
      await rules(q, { rule: "no_charge" });
      const first = await settle(q, 0);
      return { first, visit: await visit(q), payments: (await payments(q)).length, notices: await notices(q) };
    });
    expect(r.first).toBe("ok");
    expect(r.visit).toMatchObject({ status: "cancelled", cancel_reason: "no_access", late_cancel_fee_pence: 0 });
    expect(r.payments).toBe(0);
    expect(r.notices).toEqual([{ kind: "no_access_fee", customer_id: U.anna, payment: false, visit_id: clean }]);
  });

  it("decide each time: the office's choice, charge or not, and the choice is required", async () => {
    const r = await as("superuser", async (q) => {
      await missed(q);
      await rules(q, { rule: "admin_decides", fee: 1500, split: "same_as_clean" });
      const noChoice = await settle(q, 1500, null);
      const waived = await settle(q, 1500, false);
      const waivedVisit = await visit(q);
      const waivedPays = (await payments(q)).length;
      return { noChoice, waived, waivedVisit, waivedPays };
    });
    expect(r).toMatchObject({ noChoice: "PC068", waived: "ok", waivedPays: 0 });
    expect(r.waivedVisit).toMatchObject({ status: "cancelled", cancel_reason: "no_access", late_cancel_fee_pence: 0 });

    const charged = await as("superuser", async (q) => {
      await missed(q);
      await rules(q, { rule: "admin_decides", fee: 1500, split: "same_as_clean" });
      return { code: await settle(q, 1500, true), payments: (await payments(q)).map((p) => [p.amount_pence, p.cleaner_amount_pence, p.application_fee_pence]) };
    });
    expect(charged).toEqual({ code: "ok", payments: [[1500, 1125, 375]] });
  });

  it("PC068 when the cost shown isn't the cost now, and nothing is done", async () => {
    const r = await as("superuser", async (q) => {
      await missed(q);
      await rules(q, { rule: "late_cancel_fee", fee: 1500, split: "same_as_clean" });
      const out = {
        stale: await settle(q, 1000),
        missing: await settle(q, null),
        choiceNotAsked: await settle(q, 1500, false), // the page showed a choice; the rule changed since
      };
      await rules(q, { rule: "no_charge" });
      const nowFree = await settle(q, 1500);
      return { ...out, nowFree, status: (await visit(q)).status, payments: (await payments(q)).length, notices: (await notices(q)).length, record: (await record(q)).length };
    });
    expect(r).toEqual({ stale: "PC068", missing: "PC068", choiceNotAsked: "PC068", nowFree: "PC068", status: "no_show", payments: 0, notices: 0, record: 0 });
  });

  it("is refused for a clean that was started (they got in), one waiting for cover, one with no cleaner, and today's", async () => {
    const r = await as("superuser", async (q) => {
      await rules(q, { rule: "late_cancel_fee", fee: 1500, split: "same_as_clean" });
      const today = await settle(q, 1500);
      await missed(q, "unfinished");
      const started = await settle(q, 1500);
      await q.rows(`update public.visits set status = 'no_show', started_at = null where id = $1`, [clean]);
      await q.rows(`insert into public.engine_alerts (kind, series_id, visit_id, message) values ('visit_needs_cover', $1, $2, 'Arrange cover.')`, [IDS.annaSeries, clean]);
      const cover = await settle(q, 1500);
      await q.rows(`update public.engine_alerts set resolved_at = now() where visit_id = $1 and kind = 'visit_needs_cover'`, [clean]);
      await q.rows(`update public.visits set cleaner_id = null where id = $1`, [clean]);
      const noCleaner = await settle(q, 1500);
      return { today, started, cover, noCleaner, payments: (await payments(q)).length, record: (await record(q)).length };
    });
    expect(r).toEqual({ today: "PC056", started: "PC056", cover: "PC058", noCleaner: "PC057", payments: 0, record: 0 });
  });

  it("the way back: a missed clean already marked as not done can become no access, but only by a page that knows", async () => {
    const r = await as("superuser", async (q) => {
      await missed(q);
      await rules(q, { rule: "late_cancel_fee", fee: 1500, split: "same_as_clean" });
      await q.actAs(U.admin);
      await q.rows(`select public.admin_settle_visit($1, 'not_done', 'Anna says nobody came.')`, [clean]);
      await su(q);
      const stale = await settle(q, 1500, null, false);
      const knowing = await settle(q, 1500, null, true);
      return { stale, knowing, visit: (await visit(q)).cancel_reason, record: (await record(q)).map((x) => x.outcome), payments: (await payments(q)).length };
    });
    expect(r).toEqual({ stale: "PC056", knowing: "ok", visit: "no_access", record: ["not_done", "no_access"], payments: 1 });
  });

  it("the last clean of a block ends the block", async () => {
    const r = await as("superuser", async (q) => {
      await rules(q, { rule: "late_cancel_fee", fee: 1500, split: "same_as_clean" });
      // Only this clean and the done one left in the block.
      await q.rows(`update public.series set block_size = 2 where id = $1`, [IDS.annaSeries]);
      await q.rows(`delete from public.visits where id = $1`, [IDS.visitNextWeek]);
      await missed(q);
      const code = await settle(q, 1500);
      return { code, series: (await q.rows<{ status: string }>(`select status::text from public.series where id = $1`, [IDS.annaSeries]))[0]!.status };
    });
    expect(r).toEqual({ code: "ok", series: "ended" });
  });

  it("the old three- and four-argument calls still settle as before", async () => {
    const r = await as("superuser", async (q) => {
      await missed(q);
      await q.actAs(U.admin);
      return q.attempt(`select public.admin_settle_visit($1, 'not_done', $2)`, [clean, WHY]);
    });
    expect(r).toBe("ok");
  });
});

describe("the customer's email", () => {
  it("is claimed once with the clean's date and the fee, and with the date and no amount when there's no fee", async () => {
    const r = await as("superuser", async (q) => {
      await missed(q);
      await rules(q, { rule: "late_cancel_fee", fee: 1500, split: "same_as_clean" });
      await settle(q, 1500);
      await server(q);
      const claimed = await q.rows<{ kind: string; email: string; amount_pence: number | null; clean_date: string; payment_id: string | null }>(
        `select kind, email, amount_pence, clean_date::text, payment_id from public.notices_claim(20) where kind = 'no_access_fee'`);
      const again = await q.rows(`select 1 from public.notices_claim(20) where kind = 'no_access_fee'`);
      await su(q);
      const [{ d }] = await q.rows<{ d: string }>(`select (private.london_today() - 1)::text as d`) as [{ d: string }];
      return { claimed: claimed.map((c) => ({ ...c, payment_id: !!c.payment_id })), again: again.length, d };
    });
    expect(r.claimed).toEqual([{ kind: "no_access_fee", email: expect.stringContaining("@"), amount_pence: 1500, clean_date: r.d, payment_id: true }]);
    expect(r.again).toBe(0);

    const free = await as("superuser", async (q) => {
      await missed(q);
      await rules(q, { rule: "no_charge" });
      await settle(q, 0);
      await server(q);
      const c = await q.rows<{ amount_pence: number | null; clean_date: string | null }>(`select amount_pence, clean_date from public.notices_claim(20) where kind = 'no_access_fee'`);
      return c;
    });
    expect(free).toHaveLength(1);
    expect(free[0]!.amount_pence).toBeNull();
    expect(free[0]!.clean_date).not.toBeNull();
  });

  it("a no-access notice must name its clean, and only that kind does", async () => {
    const r = await as("superuser", async (q) => ({
      noClean: await q.attempt(`insert into private.customer_notices (customer_id, kind, dedupe) values ($1, 'no_access_fee', 'x1')`, [U.anna]),
      otherWithClean: await q.attempt(`insert into private.customer_notices (customer_id, kind, visit_id, dedupe) values ($1, 'payment_failed', $2, 'x2')`, [U.anna, clean]),
    }));
    expect(r).toEqual({ noClean: "23514", otherWithClean: "23514" });
  });
});

describe("the money, all the way: settled as no access, charged by the job, paid out to the cleaner", () => {
  it("£15.00 from Anna's card: £3.75 to Ping as the application fee, £11.25 to Tara's bank after the check period", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`insert into private.customer_billing (customer_id, stripe_customer_id, default_payment_method_id) values ($1, 'cus_TestAnna0001', 'pm_TestAnna0001')`, [U.anna]);
      await missed(q);
      await rules(q, { rule: "late_cancel_fee", fee: 1500, split: "same_as_clean" });
      const told = await quote(q);
      const settled = await settle(q, told.fee_pence);

      // The charge job: the fee, with Ping's part as the application fee, to Tara's account.
      await server(q);
      const [c] = await q.rows<{ payment_id: string; mode: string; amount_pence: number; application_fee_pence: number; cleaner_account_id: string }>(
        `select payment_id, mode, amount_pence, application_fee_pence, cleaner_account_id from public.charge_claim(10)`);
      const said = (await q.rows<{ r: string }>(`select public.stripe_payment_result($1, 'pi_TestNoAccess0001', 'succeeded', $2, $3, $4, 'ch_TestNoAccess001', null, null) as r`,
        [c!.payment_id, c!.amount_pence, c!.application_fee_pence, c!.cleaner_account_id]))[0]!.r;
      await su(q);
      const [acct] = await q.rows<{ a: string }>(`select stripe_account_id as a from public.cleaners where id = $1`, [U.tara]);
      const [paid] = await q.rows<{ status: string }>(`select status::text from public.payments where id = $1`, [c!.payment_id]);

      // Tara's part waits out the check period, then goes in her bank payout.
      const [po] = await q.rows<{ status: string; amount_pence: number; waits: boolean }>(
        `select status::text, amount_pence, available_after > now() as waits from public.payouts where visit_id = $1`, [clean]);
      await q.rows(`update public.payouts set available_after = now() - interval '1 minute' where visit_id = $1`, [clean]);
      await server(q);
      const due = await q.rows<{ due_pence: number }>(`select due_pence from public.payout_due_cleaners() where cleaner_id = $1`, [U.tara]);
      const [b] = await q.rows<{ amount_pence: number }>(`select amount_pence from public.payout_batch_open($1, 5000)`, [U.tara]);
      await su(q);
      return { told, settled, charge: { mode: c!.mode, amount: c!.amount_pence, ping: c!.application_fee_pence, toTara: c!.cleaner_account_id === acct!.a },
               said, paid: paid!.status, po, due: due[0]?.due_pence, batch: b?.amount_pence };
    });
    console.log(`no-access money test: fee ${r.charge.amount}p charged, Ping ${r.charge.ping}p, cleaner payout ${r.po?.amount_pence}p, batch ${r.batch}p`);
    expect(r).toEqual({
      told: { rule: "late_cancel_fee", fee_pence: 1500, cleaner_pence: 1125, ping_pence: 375 },
      settled: "ok",
      charge: { mode: "create", amount: 1500, ping: 375, toTara: true },
      said: "succeeded", paid: "succeeded",
      po: { status: "pending", amount_pence: 1125, waits: true },
      due: 1125, batch: 1125,
    });
  });
});
