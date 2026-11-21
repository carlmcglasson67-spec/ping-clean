// Settling a clean by hand (admin_settle_visit): a missed clean, or one started and never
// finished, is marked as done or not done by the Ping team. Who may, which cleans, what it
// does to the clean, the money, the alerts and the record. Plan: intent/settle/plan.md.
import { afterAll, describe, expect, it } from "vitest";
import { as, DENIED, IDS, pool, U, type Query } from "./helpers";

afterAll(() => pool.end());

const clean = IDS.visitToday; // Anna's clean today, Tara's (seed): moved to yesterday below
const SETTLE = `select public.admin_settle_visit($1, $2, $3)`;
const WHY = "Tara had no signal at the house. Anna confirmed the clean was done.";

const su = (q: Query) => q.rows(`reset role`);

/** Yesterday's clean, left the way the night's job leaves it: missed, or started and never finished. */
async function yesterday(q: Query, how: "missed" | "unfinished", opts: { couldntDo?: boolean } = {}) {
  await q.rows(`update public.visits set scheduled_date = private.london_today() - 1 where id = $1`, [clean]);
  if (how === "unfinished") {
    await q.rows(`update public.visits set status = 'in_progress', started_at = now() - interval '1 day' where id = $1`, [clean]);
    await q.rows(`insert into public.checklist_items (visit_id, item_key, room, label, position, done, skipped_reason)
                  values ($1, 'kitchen.sink', 'Kitchen', 'Sink and taps cleaned and polished', 0, true, null),
                         ($1, 'bins.empty', 'Whole home', 'Bins emptied and bags replaced', 1, false, $2)`,
      [clean, opts.couldntDo ? "Bins already collected" : null]);
  }
  await q.rows(`select private.close_stale_visits()`);
}

type State = {
  status: string; started: boolean; completed: boolean; couldnt_do_count: number; cancel_reason: string | null; cancelled_by: string | null;
  price_pence: number; cleaner_earnings_pence: number; ping_fee_pence: number;
};
const state = async (q: Query) => (await q.rows<State>(
  `select status::text, started_at is not null as started, completed_at is not null as completed, couldnt_do_count::int,
          cancel_reason, cancelled_by, price_pence, cleaner_earnings_pence, ping_fee_pence
     from public.visits where id = $1`, [clean]))[0]!;
const payments = (q: Query) => q.rows<{ status: string; amount_pence: number; application_fee_pence: number; cleaner_amount_pence: number }>(
  `select status::text, amount_pence, application_fee_pence, cleaner_amount_pence from public.payments where visit_id = $1`, [clean]);
const alerts = (q: Query) => q.rows<{ kind: string; open: boolean; by: string | null }>(
  `select kind, resolved_at is null as open, resolved_by as by from public.engine_alerts where visit_id = $1 order by kind`, [clean]);
const record = (q: Query) => q.rows<{ outcome: string; was_status: string; reason: string; actor_id: string }>(
  `select outcome, was_status::text, reason, actor_id from public.visit_settlements where visit_id = $1 order by created_at, id`, [clean]);
const done = async (q: Query) => (await q.rows<{ n: number }>(`select completed_visits::int as n from public.cleaners where id = $1`, [U.tara]))[0]!.n;

describe("who may settle a clean, and which cleans", () => {
  it("is for the Ping team only", async () => {
    const r = await as("superuser", async (q) => {
      await yesterday(q, "missed");
      const out: Record<string, string> = {};
      for (const who of ["anna", "tara", "alex"] as const) {
        await q.actAs(U[who]);
        out[who] = await q.attempt(SETTLE, [clean, "done", WHY]);
      }
      await su(q);
      return { out, state: (await state(q)).status, payments: (await payments(q)).length };
    });
    const anon = await as("anon", (q) => q.attempt(SETTLE, [clean, "done", WHY]));
    expect(r).toEqual({ out: { anna: DENIED, tara: DENIED, alex: DENIED }, state: "no_show", payments: 0 });
    expect(anon).toBe(DENIED);
  });

  it("only takes a missed or unfinished clean from a day that has gone", async () => {
    const r = await as("superuser", async (q) => {
      await q.actAs(U.admin);
      const scheduledToday = await q.attempt(SETTLE, [clean, "done", WHY]);
      const nextWeek = await q.attempt(SETTLE, [IDS.visitNextWeek, "not_done", WHY]);
      const alreadyDone = await q.attempt(SETTLE, [IDS.visitDone, "done", WHY]);
      const noSuchClean = await q.attempt(SETTLE, ["00000000-0000-4000-e000-00000000ffff", "done", WHY]);
      // Under way today: still the cleaner's to finish.
      await su(q);
      await q.rows(`update public.visits set status = 'in_progress', started_at = now() where id = $1`, [clean]);
      await q.actAs(U.admin);
      const underWayToday = await q.attempt(SETTLE, [clean, "not_done", WHY]);
      return { scheduledToday, nextWeek, alreadyDone, noSuchClean, underWayToday };
    });
    expect(r).toEqual({ scheduledToday: "PC056", nextWeek: "PC056", alreadyDone: "PC056", noSuchClean: "PC056", underWayToday: "PC056" });
  });

  it("needs a known outcome and a real reason", async () => {
    const r = await as("superuser", async (q) => {
      await yesterday(q, "missed");
      await q.actAs(U.admin);
      return {
        outcome: await q.attempt(SETTLE, [clean, "refund", WHY]),
        noOutcome: await q.attempt(SETTLE, [clean, null, WHY]),
        noReason: await q.attempt(SETTLE, [clean, "done", null]),
        blank: await q.attempt(SETTLE, [clean, "done", "   "]),
        noWords: await q.attempt(SETTLE, [clean, "done", "?? !!"]),
        tooLong: await q.attempt(SETTLE, [clean, "done", "a".repeat(301)]),
      };
    });
    expect(r).toEqual({ outcome: "22023", noOutcome: "22023", noReason: "22023", blank: "22023", noWords: "22023", tooLong: "22023" });
  });
});

describe("it was done", () => {
  it("completes a missed clean, charges it once with its own three amounts, and keeps the record", async () => {
    const r = await as("superuser", async (q) => {
      await yesterday(q, "missed");
      const before = { clean: await state(q), alerts: await alerts(q), tara: await done(q) };
      await q.actAs(U.admin);
      const first = await q.attempt(SETTLE, [clean, "done", `  ${WHY}  `]);
      const again = await q.attempt(SETTLE, [clean, "done", WHY]);
      const undo = await q.attempt(SETTLE, [clean, "not_done", WHY]);
      await su(q);
      const audit = await q.rows<{ actor_id: string; detail: { reason?: unknown; visit_id?: string; outcome?: { to?: string } } }>(
        `select actor_id, detail from public.audit_log where entity = 'visit_settlements'`);
      const visitAudit = await q.rows<{ actor_id: string }>(
        `select actor_id from public.audit_log where entity = 'visits' and entity_id = $1 and detail -> 'status' ->> 'to' = 'completed'`, [clean]);
      return { before, first, again, undo, clean: await state(q), payments: await payments(q), alerts: await alerts(q), record: await record(q),
               tara: await done(q), audit, visitAudit };
    });
    expect(r.before.clean.status).toBe("no_show");
    expect(r.before.alerts).toEqual([{ kind: "visit_no_show", open: true, by: null }]);
    expect(r).toMatchObject({ first: "ok", again: "PC056", undo: "PC056" });
    expect(r.clean).toMatchObject({ status: "completed", started: true, completed: true, couldnt_do_count: 0, cancel_reason: null });
    expect(r.clean.price_pence).toBe(r.clean.cleaner_earnings_pence + r.clean.ping_fee_pence);
    expect(r.payments).toEqual([{ status: "pending", amount_pence: r.clean.price_pence,
      application_fee_pence: r.clean.ping_fee_pence, cleaner_amount_pence: r.clean.cleaner_earnings_pence }]);
    expect(r.alerts).toEqual([{ kind: "visit_no_show", open: false, by: U.admin }]);
    expect(r.record).toEqual([{ outcome: "done", was_status: "no_show", reason: WHY, actor_id: U.admin }]);
    expect(r.tara).toBe(r.before.tara + 1);
    // In the audit log with the admin as the actor, and never the words of the reason.
    expect(r.audit).toHaveLength(1);
    expect(r.audit[0]).toMatchObject({ actor_id: U.admin, detail: { reason: "changed", visit_id: clean, outcome: { to: "done" } } });
    expect(JSON.stringify(r.audit)).not.toContain("signal");
    expect(r.visitAudit).toEqual([{ actor_id: U.admin }]);
  });

  it("finishes a clean that was started and never completed, counting its \"couldn't do\" items and still charging", async () => {
    const r = await as("superuser", async (q) => {
      await yesterday(q, "unfinished", { couldntDo: true });
      const before = await alerts(q);
      await q.actAs(U.admin);
      const settled = await q.attempt(SETTLE, [clean, "done", WHY]);
      await su(q);
      return { before, settled, clean: await state(q), payments: (await payments(q)).map((p) => p.status), alerts: await alerts(q), record: await record(q) };
    });
    expect(r.before).toEqual([{ kind: "visit_unfinished", open: true, by: null }]);
    expect(r.settled).toBe("ok");
    expect(r.clean).toMatchObject({ status: "completed", completed: true, couldnt_do_count: 1 });
    // The team has looked at it, so it isn't held for a second look (no charge_held alert).
    expect(r.payments).toEqual(["pending"]);
    expect(r.alerts).toEqual([{ kind: "visit_unfinished", open: false, by: U.admin }]);
    expect(r.record).toMatchObject([{ outcome: "done", was_status: "in_progress" }]);
  });

  it("can't be said of a clean that had no cleaner", async () => {
    const r = await as("superuser", async (q) => {
      await yesterday(q, "missed");
      await q.rows(`update public.visits set cleaner_id = null where id = $1`, [clean]);
      await q.actAs(U.admin);
      const done_ = await q.attempt(SETTLE, [clean, "done", WHY]);
      const notDone = await q.attempt(SETTLE, [clean, "not_done", WHY]);
      await su(q);
      return { done_, notDone, clean: (await state(q)).status, payments: (await payments(q)).length };
    });
    expect(r).toEqual({ done_: "PC057", notDone: "ok", clean: "no_show", payments: 0 });
  });
});

describe("it wasn't done", () => {
  it("cancels a clean that was started, and charges nobody", async () => {
    const r = await as("superuser", async (q) => {
      await yesterday(q, "unfinished");
      const tara = await done(q);
      await q.actAs(U.admin);
      const first = await q.attempt(SETTLE, [clean, "not_done", WHY]);
      const again = await q.attempt(SETTLE, [clean, "not_done", WHY]);
      const afterAll_ = await q.attempt(SETTLE, [clean, "done", WHY]);
      await su(q);
      return { first, again, afterAll_, clean: await state(q), payments: (await payments(q)).length, alerts: await alerts(q), record: await record(q), same: (await done(q)) === tara };
    });
    expect(r).toMatchObject({ first: "ok", again: "PC056", afterAll_: "PC056", payments: 0, same: true });
    expect(r.clean).toMatchObject({ status: "cancelled", completed: false, cancel_reason: "admin", cancelled_by: U.admin });
    expect(r.alerts).toEqual([{ kind: "visit_unfinished", open: false, by: U.admin }]);
    expect(r.record).toEqual([{ outcome: "not_done", was_status: "in_progress", reason: WHY, actor_id: U.admin }]);
  });

  it("leaves a missed clean as missed, and can still become done if the clean did happen", async () => {
    const r = await as("superuser", async (q) => {
      await yesterday(q, "missed");
      await q.actAs(U.admin);
      const notDone = await q.attempt(SETTLE, [clean, "not_done", "Anna says nobody came."]);
      await su(q);
      const between = { clean: (await state(q)).status, payments: (await payments(q)).length, alerts: await alerts(q) };
      await q.actAs(U.admin);
      const notDoneAgain = await q.attempt(SETTLE, [clean, "not_done", "Anna says nobody came."]);
      const doneAfterAll = await q.attempt(SETTLE, [clean, "done", "Tara sent her photos: the clean was done."]);
      await su(q);
      return { notDone, between, notDoneAgain, doneAfterAll, clean: (await state(q)).status, payments: (await payments(q)).map((p) => p.status),
               record: (await record(q)).map((s) => s.outcome) };
    });
    expect(r).toEqual({
      notDone: "ok",
      between: { clean: "no_show", payments: 0, alerts: [{ kind: "visit_no_show", open: false, by: U.admin }] },
      notDoneAgain: "PC056", doneAfterAll: "ok", clean: "completed", payments: ["pending"], record: ["not_done", "done"],
    });
  });
});

describe("the record of what the team decided", () => {
  it("is read by the Ping team only, and written by nobody directly", async () => {
    const r = await as("superuser", async (q) => {
      await yesterday(q, "missed");
      await q.actAs(U.admin);
      await q.rows(SETTLE, [clean, "done", WHY]);
      const admin = {
        sees: await q.count("public.visit_settlements"),
        writes: await q.attempt(`insert into public.visit_settlements (visit_id, outcome, was_status, reason, actor_id) values ($1, 'done', 'no_show', 'By hand', $2)`, [clean, U.admin]),
        edits: await q.attempt(`update public.visit_settlements set reason = 'changed'`),
        deletes: await q.attempt(`delete from public.visit_settlements`),
      };
      const others: Record<string, number> = {};
      for (const who of ["anna", "tara"] as const) {
        await q.actAs(U[who]); // the customer and the cleaner of this very clean
        others[who] = await q.count("public.visit_settlements");
      }
      return { admin, others };
    });
    expect(r).toEqual({ admin: { sees: 1, writes: DENIED, edits: DENIED, deletes: DENIED }, others: { anna: 0, tara: 0 } });
  });
});
