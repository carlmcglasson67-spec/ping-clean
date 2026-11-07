// The visit day: start_visit, the checklist (ticked or "couldn't do"), complete_visit.
import { afterAll, describe, expect, it } from "vitest";
import { as, CHECK, DENIED, IDS, pool, setupThen, U, type Query } from "./helpers";

afterAll(() => pool.end());

const START = `select public.start_visit($1)`;
const COMPLETE = `select public.complete_visit($1)`;
const today = IDS.visitToday; // Anna's clean today, Tara's (seed)

/** Upload the file to the private bucket, then record it, as the cleaner app does. */
const photo = async (q: Query, kind: "before" | "after", name: string, upload = true) => {
  if (upload) await q.rows(`insert into storage.objects (bucket_id, name, owner) values ('visit-photos', $1, auth.uid())`, [`${today}/${name}.jpg`]);
  await q.rows(`insert into public.visit_photos (visit_id, kind, storage_path, uploaded_by) values ($1, $2, $3, $4)`,
    [today, kind, `${today}/${name}.jpg`, U.tara]);
};

/** Tara starts today's clean, ticks everything but the bins, and adds photos as asked. */
async function readyToFinish(q: Query, opts: { before?: boolean; after?: boolean; skipBins?: string | null } = {}) {
  await q.rows(START, [today]);
  await q.rows(`update public.checklist_items set done = true where visit_id = $1 and item_key <> 'bins.empty'`, [today]);
  if (opts.skipBins !== null) {
    await q.rows(`update public.checklist_items set skipped_reason = $2 where visit_id = $1 and item_key = 'bins.empty'`,
      [today, opts.skipBins ?? "Bins already collected, nothing to empty"]);
  }
  if (opts.before ?? true) await photo(q, "before", "b1");
  if (opts.after ?? true) await photo(q, "after", "a1");
}

describe("start_visit", () => {
  it("starts the cleaner's own clean today, stamps the time on the server and lays out the checklist", async () => {
    const r = await as("tara", async (q) => {
      await q.rows(START, [today]);
      const [v] = await q.rows<{ status: string; age: number }>(`select status, extract(epoch from now() - started_at)::int as age from public.visits where id = $1`, [today]);
      const items = await q.count(`public.checklist_items where visit_id = '${today}'`);
      const first = await q.rows<{ started_at: Date }>(`select started_at from public.visits where id = $1`, [today]);
      await new Promise((res) => setTimeout(res, 20));
      const retry = await q.attempt(START, [today]); // bad signal, tapped again
      const second = await q.rows<{ started_at: Date }>(`select started_at from public.visits where id = $1`, [today]);
      return { v, items, retry, same: first[0]!.started_at.getTime() === second[0]!.started_at.getTime(),
               itemsAfter: await q.count(`public.checklist_items where visit_id = '${today}'`) };
    });
    expect(r.v).toEqual({ status: "in_progress", age: 0 });
    expect(r).toMatchObject({ items: 11, retry: "ok", same: true, itemsAfter: 11 });
  });

  it("is refused to anyone but the cleaner who holds the job", async () => {
    expect(await as("alex", (q) => q.attempt(START, [today]))).toBe("PC010");
    for (const who of ["anna", "ben", "sam", "admin", "anon"] as const) {
      expect({ who, code: await as(who, (q) => q.attempt(START, [today])) }).toEqual({ who, code: DENIED });
    }
  });

  it("only works on the day", async () => {
    expect(await as("tara", (q) => q.attempt(START, [IDS.visitNextWeek]))).toBe("PC011");
  });

  it("refuses a finished, cancelled or paused clean", async () => {
    expect(await as("tara", (q) => q.attempt(START, [IDS.visitDone]))).toBe("PC012");
    expect(await setupThen(async (su) => { await su.rows(`update public.visits set status = 'cancelled', cancelled_at = now() where id = $1`, [today]); },
      U.tara, (q) => q.attempt(START, [today]))).toBe("PC012");
    expect(await setupThen(async (su) => { await su.rows(`update public.series set status = 'paused' where id = $1`, [IDS.annaSeries]); },
      U.tara, (q) => q.attempt(START, [today]))).toBe("PC012");
  });

  it("refuses a suspended cleaner, and one whose job went back on the board", async () => {
    expect(await setupThen(async (su) => { await su.rows(`update public.cleaners set status = 'suspended' where id = $1`, [U.tara]); },
      U.tara, (q) => q.attempt(START, [today]))).toBe(DENIED);
    // Reopened: today's visit stays booked (for the admin to cover), but it isn't Tara's job any more.
    expect(await setupThen(async (su) => { await su.rows(`select private.reopen_series($1)`, [IDS.annaSeries]); },
      U.tara, (q) => q.attempt(START, [today]))).toBe("PC010");
  });

  it("won't start without a checklist to follow", async () => {
    expect(await setupThen(async (su) => { await su.rows(`update public.checklist_templates set is_default = false`); },
      U.tara, (q) => q.attempt(START, [today]))).toBe("PC015");
  });
});

describe("the checklist: ticked, or \"couldn't do\" with a reason", () => {
  it("records a reason with a server time, and refuses a blank one", async () => {
    const r = await as("tara", async (q) => {
      await q.rows(START, [today]);
      const blank = await q.attempt(`update public.checklist_items set skipped_reason = '   ' where visit_id = $1 and item_key = 'rooms.beds'`, [today]);
      const empty = await q.attempt(`update public.checklist_items set skipped_reason = '' where visit_id = $1 and item_key = 'rooms.beds'`, [today]);
      const long = await q.attempt(`update public.checklist_items set skipped_reason = repeat('x', 301) where visit_id = $1 and item_key = 'rooms.beds'`, [today]);
      const ok = await q.attempt(`update public.checklist_items set skipped_reason = 'No linen left out' where visit_id = $1 and item_key = 'rooms.beds'`, [today]);
      const both = await q.attempt(`update public.checklist_items set done = true where visit_id = $1 and item_key = 'rooms.beds'`, [today]);
      const fakeTime = await q.attempt(`update public.checklist_items set skipped_at = '2020-01-01' where visit_id = $1`, [today]);
      const [item] = await q.rows<{ age: number }>(`select extract(epoch from now() - skipped_at)::int as age from public.checklist_items where visit_id = $1 and item_key = 'rooms.beds'`, [today]);
      const undo = await q.attempt(`update public.checklist_items set skipped_reason = null, done = true where visit_id = $1 and item_key = 'rooms.beds'`, [today]);
      const [after] = await q.rows(`select done, skipped_reason, skipped_at from public.checklist_items where visit_id = $1 and item_key = 'rooms.beds'`, [today]);
      return { blank, empty, long, ok, both, fakeTime, age: item!.age, undo, after };
    });
    expect(r).toMatchObject({ blank: CHECK, empty: CHECK, long: CHECK, ok: "ok", both: CHECK, fakeTime: DENIED, age: 0, undo: "ok" });
    expect(r.after).toEqual({ done: true, skipped_reason: null, skipped_at: null });
  });

  it("can't be changed by the customer, another cleaner, or after the clean is finished", async () => {
    expect(await as("anna", (q) => q.attempt(`update public.checklist_items set skipped_reason = 'x' where visit_id = $1`, [IDS.visitDone]))).toBe("no-rows");
    expect(await as("alex", (q) => q.attempt(`update public.checklist_items set skipped_reason = 'x'`))).toBe("no-rows");
    expect(await as("tara", (q) => q.attempt(`update public.checklist_items set skipped_reason = 'x' where visit_id = $1`, [IDS.visitDone]))).toBe("no-rows");
  });
});

describe("complete_visit", () => {
  it("refuses until every item is ticked or has a reason, saying how many are left", async () => {
    const r = await as("tara", async (q) => {
      await q.rows(START, [today]);
      const none = await q.failure(COMPLETE, [today]);
      await tickAllButBins(q);
      const one = await q.failure(COMPLETE, [today]);
      return { none, one };
    });
    expect(r.none).toEqual({ code: "PC013", detail: "11" });
    expect(r.one).toEqual({ code: "PC013", detail: "1" });
  });

  it("refuses until there's a before and an after photo, saying which is missing", async () => {
    const both = await as("tara", async (q) => { await readyToFinish(q, { before: false, after: false }); return q.failure(COMPLETE, [today]); });
    const after = await as("tara", async (q) => { await readyToFinish(q, { after: false }); return q.failure(COMPLETE, [today]); });
    const before = await as("tara", async (q) => { await readyToFinish(q, { before: false }); return q.failure(COMPLETE, [today]); });
    expect(both).toEqual({ code: "PC014", detail: "before,after" });
    expect(after).toEqual({ code: "PC014", detail: "after" });
    expect(before).toEqual({ code: "PC014", detail: "before" });
  });

  it("doesn't count a photo record with no uploaded file (security review)", async () => {
    const r = await as("tara", async (q) => {
      await readyToFinish(q, { after: false });
      await photo(q, "after", "fake", false);
      return q.failure(COMPLETE, [today]);
    });
    expect(r).toEqual({ code: "PC014", detail: "after" });
  });

  it("never lets a cleaner add, remove or re-label checklist items themselves", async () => {
    const r = await as("tara", async (q) => {
      await q.rows(START, [today]);
      return {
        add: await q.attempt(`insert into public.checklist_items (visit_id, item_key, room, label, done) values ($1, 'x', 'x', 'x', true)`, [today]),
        remove: await q.attempt(`delete from public.checklist_items where visit_id = $1 and item_key = 'bins.empty'`, [today]),
        relabel: await q.attempt(`update public.checklist_items set label = 'Nothing' where visit_id = $1`, [today]),
      };
    });
    expect(r).toEqual({ add: DENIED, remove: DENIED, relabel: DENIED });
  });

  it("completes with server times, flags couldn't-do items for QC, counts the clean once, and moves no money", async () => {
    const r = await as("tara", async (q) => {
      await readyToFinish(q);
      await q.rows(COMPLETE, [today]);
      const retry = await q.attempt(COMPLETE, [today]);
      const [v] = await q.rows(`select status, couldnt_do_count, extract(epoch from now() - completed_at)::int as age from public.visits where id = $1`, [today]);
      const [c] = await q.rows<{ completed_visits: number }>(`select completed_visits from public.cleaners where id = $1`, [U.tara]);
      return { retry, v, c };
    });
    expect(r.v).toEqual({ status: "completed", couldnt_do_count: 1, age: 0 });
    expect(r.c!.completed_visits).toBe(65); // 64 in the seed, +1 once, not twice
    expect(r.retry).toBe("ok");
    const [money] = await as("superuser", async (q) => {
      await q.actAs(U.tara);
      await readyToFinish(q);
      await q.rows(COMPLETE, [today]);
      await q.rows(`reset role`);
      return q.rows(`select (select count(*)::int from public.payments) as payments, (select count(*)::int from public.payouts) as payouts`);
    });
    expect(money).toEqual({ payments: 1, payouts: 1 }); // just the seeded ones
  });

  it("audits the completion with the cleaner as the actor", async () => {
    const row = await as("superuser", async (q) => {
      await q.actAs(U.tara);
      await readyToFinish(q);
      await q.rows(COMPLETE, [today]);
      await q.rows(`reset role`);
      return (await q.rows<{ actor_id: string; detail: { status: unknown; couldnt_do_count: unknown } }>(
        `select actor_id, detail from public.audit_log where entity = 'visits' and entity_id = $1 order by id desc limit 1`, [today]))[0];
    });
    expect(row).toMatchObject({ actor_id: U.tara, detail: { status: { from: "in_progress", to: "completed" }, couldnt_do_count: { from: 0, to: 1 } } });
  });

  it("is refused to anyone but the cleaner doing the clean", async () => {
    const code = (who: string) => setupThen(async (su) => {
      await su.actAs(U.tara);
      await readyToFinish(su);
      await su.rows(`reset role`);
    }, who, (q) => q.attempt(COMPLETE, [today]));
    expect(await code(U.alex)).toBe("PC010");
    for (const who of [U.anna, U.ben, U.sam, U.admin]) expect({ who, code: await code(who) }).toEqual({ who, code: DENIED });
    expect(await as("anon", (q) => q.attempt(COMPLETE, [today]))).toBe(DENIED);
  });

  it("refuses a clean that hasn't started, and one from another day", async () => {
    expect(await as("tara", (q) => q.attempt(COMPLETE, [today]))).toBe("PC012");
    expect(await setupThen(async (su) => {
      await su.rows(`update public.visits set status = 'in_progress', started_at = now() where id = $1`, [IDS.visitNextWeek]);
    }, U.tara, (q) => q.attempt(COMPLETE, [IDS.visitNextWeek]))).toBe("PC011");
  });

  it("ends the block when the last clean is done, and the address locks again", async () => {
    const r = await setupThen(async (su) => {
      await su.rows(`update public.series set block_size = 3 where id = $1`, [IDS.annaSeries]);
      await su.rows(`update public.visits set status = 'cancelled', cancelled_at = now() where id = $1`, [IDS.visitNextWeek]);
    }, U.tara, async (q) => {
      await readyToFinish(q);
      await q.rows(COMPLETE, [today]);
      const [s] = await q.rows<{ status: string }>(`select status from public.series where id = $1`, [IDS.annaSeries]);
      return { series: s!.status, properties: await q.count("public.properties") };
    });
    expect(r).toEqual({ series: "ended", properties: 0 });
  });

  it("keeps the block going when cleans remain", async () => {
    const status = await as("tara", async (q) => {
      await readyToFinish(q);
      await q.rows(COMPLETE, [today]);
      return (await q.rows<{ status: string }>(`select status from public.series where id = $1`, [IDS.annaSeries]))[0]!.status;
    });
    expect(status).toBe("claimed");
  });
});

describe("couldn't-do items reach the admin QC queue and that customer only", () => {
  const seen = (who: keyof typeof U | "anon") => setupThen(async (su) => {
    await su.actAs(U.tara);
    await readyToFinish(su, { skipBins: "Bins already collected" });
    await su.rows(COMPLETE, [today]);
    await su.rows(`reset role`);
    if (who !== "anon") await su.actAs(U[who]);
    else await su.rows(`set local role anon`);
  }, null, async (q) => ({
    reasons: (await q.attempt(`select 1 from public.checklist_items`)) === "ok"
      ? (await q.rows<{ skipped_reason: string }>(`select skipped_reason from public.checklist_items where skipped_reason is not null`)).map((x) => x.skipped_reason)
      : [],
    queue: (await q.attempt(`select 1 from public.visits`)) === "ok"
      ? (await q.rows<{ id: string }>(`select id from public.visits where couldnt_do_count > 0`)).map((x) => x.id)
      : [],
  }));

  it("shows the admin the visit and the reason", async () => {
    expect(await seen("admin")).toEqual({ reasons: ["Bins already collected"], queue: [today] });
  });
  it("shows the customer on that visit", async () => {
    expect(await seen("anna")).toEqual({ reasons: ["Bins already collected"], queue: [today] });
  });
  it("shows the cleaner who wrote it", async () => {
    expect(await seen("tara")).toEqual({ reasons: ["Bins already collected"], queue: [today] });
  });
  it("shows nobody else", async () => {
    for (const who of ["ben", "alex", "sam", "anon"] as const) expect({ who, ...(await seen(who)) }).toEqual({ who, reasons: [], queue: [] });
  });
});

describe("visit columns stay server-only", () => {
  it("never lets a cleaner or customer set the QC flag, times or status", async () => {
    for (const who of ["tara", "anna"] as const) {
      expect(await as(who, (q) => q.attempt(`update public.visits set couldnt_do_count = 0 where id = $1`, [today]))).toBe(DENIED);
      expect(await as(who, (q) => q.attempt(`update public.visits set status = 'completed', completed_at = now() where id = $1`, [today]))).toBe(DENIED);
    }
  });
});

/** After START: tick all but the bins, leave the bins unresolved (reason null). */
async function tickAllButBins(q: Query) {
  await q.rows(`update public.checklist_items set done = true where visit_id = $1 and item_key <> 'bins.empty'`, [today]);
}
