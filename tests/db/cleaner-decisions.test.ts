// Cleaner decisions (shared request C-1): approve, decline, suspend, reactivate, change tier.
import { afterAll, describe, expect, it } from "vitest";
import { as, DENIED, pool, U, type Query } from "./helpers";

afterAll(() => pool.end());

const su = (q: Query) => q.rows(`reset role`);
const KINDS = ["insurance", "dbs", "photo_id", "right_to_work"] as const;

/** Gives a cleaner a verified, in-date newest document of every kind (superuser set-up). */
const allVerified = async (q: Query, cleaner: string) => {
  for (const kind of KINDS) {
    await q.rows(
      `insert into public.cleaner_documents (cleaner_id, kind, storage_path, expires_on, status, reviewed_by, reviewed_at, created_at)
       values ($1::uuid, $2::public.document_kind, $1::text || '/' || $2::text || '-new.pdf',
               case when $2::text = 'insurance' then (now() at time zone 'Europe/London')::date + 100 end,
               'verified', $3::uuid, now(), now() + interval '1 minute')`,
      [cleaner, kind, U.admin],
    );
  }
};
const review = async (q: Query, cleaner: string, decision: string, tier: string | null, reason: string | null, who: string = U.admin) => {
  await q.actAs(who);
  const f = await q.failure(`select public.admin_review_cleaner($1, $2, $3::public.cleaner_tier, $4)`, [cleaner, decision, tier, reason]);
  await su(q);
  return f;
};
const setTier = async (q: Query, cleaner: string, tier: string, reason: string | null, who: string = U.admin) => {
  await q.actAs(who);
  const f = await q.failure(`select public.admin_set_cleaner_tier($1, $2::public.cleaner_tier, $3)`, [cleaner, tier, reason]);
  await su(q);
  return f;
};
const cleaner = async (q: Query, id: string) =>
  (await q.rows<{ status: string; tier: string; approved_by: string | null; approved: boolean }>(
    `select status::text, tier::text, approved_by, approved_at is not null as approved from public.cleaners where id = $1`, [id]))[0]!;
const reviews = (q: Query, id: string) =>
  q.rows<{ decision: string; tier: string | null; reason: string | null; actor_id: string }>(
    `select decision, tier::text, reason, actor_id from public.cleaner_reviews where cleaner_id = $1 order by created_at, id`, [id]);

describe("who can decide", () => {
  it("only the Ping team: customers, cleaners and applicants are refused, and anon can't call it", async () => {
    const r = await as("superuser", async (q) => {
      await allVerified(q, U.sam);
      const out: Record<string, string | undefined> = {};
      for (const who of ["anna", "tara", "sam"] as const) {
        out[who] = (await review(q, U.sam, "approve", "new", null, U[who]))?.code;
        out[`${who}Tier`] = (await setTier(q, U.alex, "top", "Great feedback", U[who]))?.code;
      }
      return { out, sam: await cleaner(q, U.sam), alex: await cleaner(q, U.alex) };
    });
    expect(Object.values(r.out).every((c) => c === DENIED)).toBe(true);
    expect(r.sam.status).toBe("applicant");
    expect(r.alex.tier).toBe("approved");
    const anon = await as("anon", (q) => q.attempt(`select public.admin_review_cleaner($1, 'approve', 'new', null)`, [U.sam]));
    expect(anon).toBe(DENIED);
  });

  it("nobody can write the cleaners row or the decision log directly, and only admins read the log", async () => {
    const r = await as("superuser", async (q) => {
      await allVerified(q, U.sam);
      await review(q, U.sam, "approve", "new", null);
      await q.actAs(U.sam);
      const self = await q.attempt(`update public.cleaners set status = 'active', tier = 'top' where id = $1`, [U.sam]);
      const samSees = await q.count("public.cleaner_reviews");
      const samWrites = await q.attempt(`insert into public.cleaner_reviews (cleaner_id, decision, actor_id) values ($1, 'approve', $1)`, [U.sam]);
      await q.actAs(U.admin);
      const adminSees = await q.count("public.cleaner_reviews");
      const adminWrites = await q.attempt(`insert into public.cleaner_reviews (cleaner_id, decision, actor_id) values ($1, 'approve', $2)`, [U.sam, U.admin]);
      const adminEdits = await q.attempt(`update public.cleaner_reviews set reason = 'changed'`);
      return { self, samSees, samWrites, adminSees, adminWrites, adminEdits };
    });
    expect(r).toEqual({ self: DENIED, samSees: 0, samWrites: DENIED, adminSees: 1, adminWrites: DENIED, adminEdits: DENIED });
  });
});

describe("approving", () => {
  it("is refused until all four checks are verified and in date, and says which are waiting", async () => {
    const r = await as("superuser", async (q) => {
      const seed = await review(q, U.sam, "approve", "new", null); // seed: only a pending DBS
      await allVerified(q, U.sam);
      // A newer rejected DBS replaces the verified one; the insurance runs out today.
      await q.rows(`insert into public.cleaner_documents (cleaner_id, kind, storage_path, status, created_at)
                    values ($1::uuid, 'dbs', $1::text || '/dbs-again.pdf', 'rejected', now() + interval '2 minutes')`, [U.sam]);
      await q.rows(`update public.cleaner_documents set expires_on = (now() at time zone 'Europe/London')::date
                     where cleaner_id = $1 and kind = 'insurance'`, [U.sam]);
      const later = await review(q, U.sam, "approve", "new", null);
      return { seed, later, sam: await cleaner(q, U.sam), log: (await reviews(q, U.sam)).length };
    });
    expect(r.seed).toEqual({ code: "PC052", detail: "insurance,dbs,photo_id,right_to_work" });
    expect(r.later).toEqual({ code: "PC052", detail: "insurance,dbs" });
    expect(r.sam.status).toBe("applicant");
    expect(r.log).toBe(0);
  });

  it("makes the applicant a working cleaner at the chosen tier, stamped and logged with the admin", async () => {
    const r = await as("superuser", async (q) => {
      await allVerified(q, U.sam);
      const noTier = await review(q, U.sam, "approve", null, null);
      const done = await review(q, U.sam, "approve", "approved", null);
      const again = await review(q, U.sam, "approve", "top", null);
      const audit = await q.rows<{ actor_id: string; detail: { status?: { to: string } } }>(
        `select actor_id, detail from public.audit_log where entity = 'cleaners' and entity_id = $1 order by id desc limit 1`, [U.sam]);
      return { noTier, done, again, sam: await cleaner(q, U.sam), log: await reviews(q, U.sam), audit: audit[0] };
    });
    expect(r.noTier?.code).toBe("22023");
    expect(r.done).toBeNull();
    expect(r.again).toEqual({ code: "PC053", detail: "active" });
    expect(r.sam).toEqual({ status: "active", tier: "approved", approved_by: U.admin, approved: true });
    expect(r.log).toEqual([{ decision: "approve", tier: "approved", reason: null, actor_id: U.admin }]);
    expect(r.audit?.actor_id).toBe(U.admin);
    expect(r.audit?.detail.status?.to).toBe("active");
  });
});

describe("declining, suspending, reactivating", () => {
  it("needs a real reason to decline or suspend", async () => {
    const r = await as("superuser", async (q) => ({
      none: (await review(q, U.sam, "decline", null, null))?.code,
      dots: (await review(q, U.sam, "decline", null, " .. "))?.code,
      long: (await review(q, U.sam, "decline", null, "x".repeat(301)))?.code,
      suspend: (await review(q, U.tara, "suspend", null, ""))?.code,
      unknown: (await review(q, U.sam, "promote", null, "Because"))?.code,
    }));
    expect(r).toEqual({ none: "22023", dots: "22023", long: "22023", suspend: "22023", unknown: "22023" });
  });

  it("refuses every move that doesn't fit where the cleaner stands", async () => {
    const r = await as("superuser", async (q) => ({
      declineActive: await review(q, U.tara, "decline", null, "Changed our mind"),
      suspendApplicant: await review(q, U.sam, "suspend", null, "Not answering"),
      reactivateActive: await review(q, U.tara, "reactivate", null, null),
      tierApplicant: await setTier(q, U.sam, "top", "Seems keen"),
      missing: await review(q, "00000000-0000-4000-a000-0000000000ff", "suspend", null, "Not answering"),
    }));
    expect(r.declineActive).toEqual({ code: "PC053", detail: "active" });
    expect(r.suspendApplicant).toEqual({ code: "PC053", detail: "applicant" });
    expect(r.reactivateActive).toEqual({ code: "PC053", detail: "active" });
    expect(r.tierApplicant).toEqual({ code: "PC053", detail: "applicant" });
    expect(r.missing?.code).toBe("PC053");
  });

  it("declining an applicant marks them as left, with the reason kept for the team", async () => {
    const r = await as("superuser", async (q) => {
      const done = await review(q, U.sam, "decline", null, "  No right to work document  ");
      return { done, sam: await cleaner(q, U.sam), log: await reviews(q, U.sam) };
    });
    expect(r.done).toBeNull();
    expect(r.sam.status).toBe("left");
    expect(r.log).toEqual([{ decision: "decline", tier: null, reason: "No right to work document", actor_id: U.admin }]);
  });

  it("a suspended cleaner loses addresses and the job board at once; reactivating needs the checks again", async () => {
    const r = await as("superuser", async (q) => {
      await q.actAs(U.tara);
      const before = { homes: await q.count("public.properties"), active: (await q.rows<{ a: boolean }>(`select private.is_active_cleaner() as a`))[0]!.a };
      await su(q);
      const suspended = await review(q, U.tara, "suspend", null, "Two no-shows this month");
      await q.actAs(U.tara);
      const after = { homes: await q.count("public.properties"), active: (await q.rows<{ a: boolean }>(`select private.is_active_cleaner() as a`))[0]!.a };
      await su(q);
      const notReady = await review(q, U.tara, "reactivate", null, null); // seed: Tara has two of the four
      await allVerified(q, U.tara);
      const back = await review(q, U.tara, "reactivate", null, "Spoke on the phone, sorted");
      return { before, suspended, after, notReady, back, tara: await cleaner(q, U.tara), log: (await reviews(q, U.tara)).map((x) => x.decision) };
    });
    expect(r.before.homes).toBeGreaterThan(0);
    expect(r.before.active).toBe(true);
    expect(r.suspended).toBeNull();
    expect(r.after).toEqual({ homes: 0, active: false });
    expect(r.notReady).toEqual({ code: "PC052", detail: "photo_id,right_to_work" });
    expect(r.back).toBeNull();
    expect(r.tara.status).toBe("active");
    expect(r.tara.tier).toBe("top");
    expect(r.log).toEqual(["suspend", "reactivate"]);
  });
});

describe("changing a tier", () => {
  it("needs a reason, changes a working cleaner's tier and logs it; the same tier again writes nothing", async () => {
    const r = await as("superuser", async (q) => {
      const noReason = await setTier(q, U.alex, "top", null);
      const done = await setTier(q, U.alex, "top", "Ten cleans, all five stars");
      const same = await setTier(q, U.alex, "top", "Ten cleans, all five stars");
      return { noReason, done, same, alex: await cleaner(q, U.alex), log: await reviews(q, U.alex) };
    });
    expect(r.noReason?.code).toBe("22023");
    expect(r.done).toBeNull();
    expect(r.same).toBeNull();
    expect(r.alex.tier).toBe("top");
    expect(r.log).toEqual([{ decision: "tier", tier: "top", reason: "Ten cleans, all five stars", actor_id: U.admin }]);
  });
});
