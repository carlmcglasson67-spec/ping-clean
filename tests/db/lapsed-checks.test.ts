// Lapsed checks: the office is told when a working cleaner's documents stop being in order.
import { afterAll, describe, expect, it } from "vitest";
import { as, DENIED, pool, U, type Query } from "./helpers";

afterAll(() => pool.end());

const su = (q: Query) => q.rows(`reset role`);
const KINDS = ["insurance", "dbs", "photo_id", "right_to_work"] as const;
const open = (q: Query, cleaner: string) =>
  q.rows<{ kind: string; message: string }>(
    `select kind, message from public.engine_alerts where cleaner_id = $1 and resolved_at is null order by kind`, [cleaner]);
/** A fresh start: no documents, no alerts for this cleaner. */
const clear = async (q: Query, cleaner: string) => {
  await q.rows(`delete from public.cleaner_documents where cleaner_id = $1`, [cleaner]);
  await q.rows(`delete from public.engine_alerts where cleaner_id = $1`, [cleaner]);
};
const doc = (q: Query, cleaner: string, kind: string, status: string, expiresInDays: number | null) =>
  q.rows<{ id: string }>(
    `insert into public.cleaner_documents (cleaner_id, kind, storage_path, expires_on, status, reviewed_by, reviewed_at)
     values ($1::uuid, $2::public.document_kind, $1::text || '/' || gen_random_uuid()::text || '.pdf',
             case when $4::int is null then null else (now() at time zone 'Europe/London')::date + $4::int end,
             $3::public.document_status, case when $3 = 'pending' then null else $5::uuid end, case when $3 = 'pending' then null else now() end)
     returning id`, [cleaner, kind, status, expiresInDays, U.admin]).then((r) => r[0]!.id);
const allGood = async (q: Query, cleaner: string) => {
  await clear(q, cleaner);
  for (const k of KINDS) await doc(q, cleaner, k, "verified", k === "insurance" ? 200 : null);
};

describe("a working cleaner whose documents are in order", () => {
  it("has no alert, and the seed's cleaner with only two of four has one that names what's missing", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`select private.run_cleaner_checks()`);
      const seeded = await open(q, U.tara);
      await allGood(q, U.tara);
      return { seeded, after: await open(q, U.tara) };
    });
    expect(r.seeded.map((a) => a.kind)).toEqual(["cleaner_check_lapsed"]);
    expect(r.seeded[0]!.message).toMatch(/photo ID, right to work/);
    expect(r.seeded[0]!.message).not.toMatch(/Tara/);
    expect(r.after).toEqual([]);
  });
});

describe("lapsing", () => {
  it("a verified document sent back raises the alert at once; verifying a new one closes it", async () => {
    const r = await as("superuser", async (q) => {
      await allGood(q, U.tara);
      await q.rows(`update public.cleaner_documents set status = 'rejected', rejection_reason = 'Wrong name on it' where cleaner_id = $1 and kind = 'dbs'`, [U.tara]);
      const raised = await open(q, U.tara);
      const fresh = await doc(q, U.tara, "dbs", "pending", null);
      await q.rows(`update public.cleaner_documents set created_at = now() + interval '1 minute' where id = $1`, [fresh]); // uploaded after the rejection
      const stillOpen = await open(q, U.tara);
      await q.rows(`update public.cleaner_documents set status = 'verified', reviewed_by = $2, reviewed_at = now() where id = $1`, [fresh, U.admin]);
      return { raised, stillOpen: stillOpen.length, closed: await open(q, U.tara) };
    });
    expect(r.raised.map((a) => a.kind)).toEqual(["cleaner_check_lapsed"]);
    expect(r.raised[0]!.message).toMatch(/for: DBS check\./);
    expect(r.stillOpen).toBe(1);
    expect(r.closed).toEqual([]);
  });

  it("a date passing is caught by the nightly run, with one alert however many nights go by", async () => {
    const r = await as("superuser", async (q) => {
      await allGood(q, U.tara);
      // The insurance's end date arrives without anything else changing (the trigger is held back to mimic time passing).
      await q.rows(`alter table public.cleaner_documents disable trigger cleaner_documents_checks`);
      await q.rows(`update public.cleaner_documents set expires_on = (now() at time zone 'Europe/London')::date where cleaner_id = $1 and kind = 'insurance'`, [U.tara]);
      await q.rows(`alter table public.cleaner_documents enable trigger cleaner_documents_checks`);
      const before = await open(q, U.tara);
      await q.rows(`select private.run_cleaner_checks()`);
      await q.rows(`select private.run_cleaner_checks()`);
      return { before, after: await open(q, U.tara) };
    });
    expect(r.before).toEqual([]);
    expect(r.after.map((a) => a.kind)).toEqual(["cleaner_check_lapsed"]);
    expect(r.after[0]!.message).toMatch(/public liability insurance/);
  });

  it("a renewal uploaded early (not yet reviewed) is not a lapse", async () => {
    const r = await as("superuser", async (q) => {
      await allGood(q, U.tara);
      await doc(q, U.tara, "insurance", "pending", 400);
      return open(q, U.tara);
    });
    expect(r).toEqual([]);
  });
});

describe("running out soon", () => {
  it("warns within 14 days with the date, not before, and stops once a later document is verified", async () => {
    const r = await as("superuser", async (q) => {
      await clear(q, U.tara);
      for (const k of KINDS) await doc(q, U.tara, k, "verified", k === "insurance" ? 15 : null);
      const at15 = await open(q, U.tara);
      await q.rows(`update public.cleaner_documents set expires_on = (now() at time zone 'Europe/London')::date + 10 where cleaner_id = $1 and kind = 'insurance'`, [U.tara]);
      const at10 = await open(q, U.tara);
      await doc(q, U.tara, "insurance", "verified", 365);
      return { at15, at10, renewed: await open(q, U.tara) };
    });
    expect(r.at15).toEqual([]);
    expect(r.at10.map((a) => a.kind)).toEqual(["cleaner_check_expiring"]);
    expect(r.at10[0]!.message).toMatch(/public liability insurance runs out soon \(first on \d{1,2} \w+ \d{4}\)/);
    expect(r.renewed).toEqual([]);
  });
});

describe("who it's about", () => {
  it("only working cleaners: applicants never, and suspending closes the alerts; reactivating isn't needed to see them return", async () => {
    const r = await as("superuser", async (q) => {
      const applicant = await open(q, U.sam);
      await q.rows(`select private.run_cleaner_checks()`);
      const alex = await open(q, U.alex); // working, no documents at all (seed)
      await q.actAs(U.admin);
      await q.rows(`select public.admin_review_cleaner($1, 'suspend', null, 'Documents out of date')`, [U.alex]);
      await su(q);
      return { applicant, alex: alex.map((a) => a.kind), suspended: await open(q, U.alex), samAfterRun: await open(q, U.sam) };
    });
    expect(r.applicant).toEqual([]);
    expect(r.samAfterRun).toEqual([]);
    expect(r.alex).toEqual(["cleaner_check_lapsed"]);
    expect(r.suspended).toEqual([]);
  });

  it("resolved by hand while still lapsed: it stays quiet for a week, then comes back", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`select private.run_cleaner_checks()`);
      await q.rows(`update public.engine_alerts set resolved_at = now(), resolved_by = $2 where cleaner_id = $1 and resolved_at is null`, [U.tara, U.admin]);
      await q.rows(`select private.run_cleaner_checks()`);
      const quiet = await open(q, U.tara);
      await q.rows(`alter table public.engine_alerts disable trigger user`);
      await q.rows(`update public.engine_alerts set resolved_at = now() - interval '8 days' where cleaner_id = $1`, [U.tara]);
      await q.rows(`alter table public.engine_alerts enable trigger user`);
      await q.rows(`select private.run_cleaner_checks()`);
      return { quiet, back: (await open(q, U.tara)).map((a) => a.kind) };
    });
    expect(r.quiet).toEqual([]);
    expect(r.back).toEqual(["cleaner_check_lapsed"]);
  });
});

describe("what the review caught", () => {
  it("resolved by hand, then a different check lapses: a new alert at once, not a week of silence", async () => {
    const r = await as("superuser", async (q) => {
      await allGood(q, U.tara);
      await q.rows(`update public.cleaner_documents set status = 'rejected', rejection_reason = 'Unreadable' where cleaner_id = $1 and kind = 'right_to_work'`, [U.tara]);
      await q.rows(`update public.engine_alerts set resolved_at = now(), resolved_by = $2 where cleaner_id = $1 and resolved_at is null`, [U.tara, U.admin]);
      await q.rows(`select private.run_cleaner_checks()`);
      const quiet = await open(q, U.tara);
      await q.rows(`update public.cleaner_documents set status = 'rejected', rejection_reason = 'Out of date' where cleaner_id = $1 and kind = 'insurance'`, [U.tara]);
      return { quiet, after: await open(q, U.tara) };
    });
    expect(r.quiet).toEqual([]);
    expect(r.after.map((a) => a.kind)).toEqual(["cleaner_check_lapsed"]);
    expect(r.after[0]!.message).toMatch(/for: public liability insurance, right to work\./);
  });

  it("an older verified document doesn't cover for a newer one that was sent back", async () => {
    const r = await as("superuser", async (q) => {
      await allGood(q, U.tara);
      const newer = await doc(q, U.tara, "dbs", "pending", null);
      await q.rows(`update public.cleaner_documents set created_at = now() + interval '1 minute' where id = $1`, [newer]);
      const whilePending = await open(q, U.tara);
      await q.rows(`update public.cleaner_documents set status = 'rejected', rejection_reason = 'Not theirs', reviewed_by = $2, reviewed_at = now() where id = $1`, [newer, U.admin]);
      return { whilePending, after: await open(q, U.tara) };
    });
    expect(r.whilePending).toEqual([]);
    expect(r.after.map((a) => a.kind)).toEqual(["cleaner_check_lapsed"]);
    expect(r.after[0]!.message).toMatch(/for: DBS check\./);
  });
});

describe("access", () => {
  it("only the Ping team sees these alerts, and nobody signed in can run the check", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`select private.run_cleaner_checks()`);
      await q.actAs(U.tara);
      const tara = {
        sees: await q.count("public.engine_alerts"),
        run: await q.attempt(`select private.run_cleaner_checks()`),
        one: await q.attempt(`select private.check_cleaner($1)`, [U.tara]),
      };
      await q.actAs(U.admin);
      const admin = (await q.rows(`select 1 from public.engine_alerts where cleaner_id = $1 and resolved_at is null`, [U.tara])).length;
      return { tara, admin };
    });
    expect(r.tara).toEqual({ sees: 0, run: DENIED, one: DENIED });
    expect(r.admin).toBe(1);
  });

  it("a cleaner uploading their own document still works (the check runs with its own rights)", async () => {
    const r = await as("superuser", async (q) => {
      await q.actAs(U.tara);
      const upload = await q.attempt(`insert into public.cleaner_documents (cleaner_id, kind, storage_path) values ($1::uuid, 'photo_id', $1::text || '/id.pdf')`, [U.tara]);
      await su(q);
      return { upload, alerts: (await open(q, U.tara)).length };
    });
    expect(r).toEqual({ upload: "ok", alerts: 1 });
  });
});
