import { afterAll, describe, expect, it } from "vitest";
import { as, IDS, pool, setupThen, U, type Query } from "./helpers";

// Payments PR 5: cleaners' payments set-up (C10). A cleaner Stripe can't pay isn't offered
// work, doesn't see it, can't claim it and can't be assigned it.
afterAll(() => pool.end());

const DENIED = "42501";
const asServer = <T>(fn: (q: Query) => Promise<T>) => as("superuser", async (q) => {
  await q.rows(`set local role service_role`);
  return fn(q);
});
const UNPAYABLE = `update public.cleaners set stripe_charges_enabled = false, stripe_payouts_enabled = false where id = $1`;
const taraOffer = `(select id from public.job_offers where series_id = '${IDS.benSeries}' and cleaner_id = '${U.tara}')`;

describe("linking a cleaner's Stripe account", () => {
  it("keeps the first account, for approved cleaners only", async () => {
    const r = await asServer(async (q) => {
      const link = async (who: string, acct: string) =>
        (await q.rows<{ a: string | null }>(`select public.stripe_link_cleaner_account($1, $2) as a`, [who, acct]))[0]!.a;
      await q.rows(`reset role`);
      await q.rows(`update public.cleaners set stripe_account_id = null where id = $1`, [U.alex]);
      await q.rows(`set local role service_role`);
      return {
        first: await link(U.alex, "acct_TestAlex01"),
        second: await link(U.alex, "acct_TestAlex02"), // a second tap, or a race: the first is kept
        read: (await q.rows<{ a: string }>(`select public.stripe_cleaner_account_for($1) as a`, [U.alex]))[0]!.a,
        applicant: await q.attempt(`select public.stripe_link_cleaner_account($1, 'acct_TestSam001')`, [U.sam]),
        customer: await q.attempt(`select public.stripe_link_cleaner_account($1, 'acct_TestAnna01')`, [U.anna]),
      };
    });
    expect(r).toEqual({ first: "acct_TestAlex01", second: "acct_TestAlex01", read: "acct_TestAlex01", applicant: DENIED, customer: DENIED });
  });

  it("refuses an id that isn't a Stripe account, and one already linked to someone else", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.cleaners set stripe_account_id = null where id = $1`, [U.alex]);
      const tara = (await q.rows<{ tara: string }>(`select stripe_account_id as tara from public.cleaners where id = $1`, [U.tara]))[0]!.tara;
      await q.rows(`set local role service_role`);
      return {
        badShape: await q.attempt(`select public.stripe_link_cleaner_account($1, 'not-an-account')`, [U.alex]),
        someoneElses: await q.attempt(`select public.stripe_link_cleaner_account($1, $2)`, [U.alex, tara]),
      };
    });
    expect(r).toEqual({ badShape: "23514", someoneElses: "23505" });
  });

  it("is server only: no signed-in role can read, link or set a status", async () => {
    for (const who of ["tara", "anna", "admin", "anon"] as const) {
      expect({ who, code: await as(who, (q) => q.attempt(`select public.stripe_cleaner_account_for($1)`, [U.tara])) }).toEqual({ who, code: DENIED });
      expect({ who, code: await as(who, (q) => q.attempt(`select public.stripe_link_cleaner_account($1, 'acct_TestTara99')`, [U.tara])) }).toEqual({ who, code: DENIED });
      expect({ who, code: await as(who, (q) => q.attempt(`select public.stripe_account_status('acct_TestTara99', true, true, true, false)`)) }).toEqual({ who, code: DENIED });
    }
  });
});

describe("what Stripe says the account can do", () => {
  it("is stored against the linked cleaner, audited, and nothing is stored for an unknown account", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.cleaners set stripe_account_id = 'acct_TestAlex01', stripe_charges_enabled = false, stripe_payouts_enabled = false,
                      stripe_details_submitted = false, stripe_status_at = null where id = $1`, [U.alex]);
      await q.rows(`set local role service_role`);
      const set = async (acct: string, ...v: boolean[]) =>
        (await q.rows<{ s: string }>(`select public.stripe_account_status($1, $2, $3, $4, $5) as s`, [acct, ...v]))[0]!.s;
      const unknown = await set("acct_NobodyAtAll1", true, true, true, false);
      const half = await set("acct_TestAlex01", true, false, true, true);
      await q.rows(`reset role`);
      const [afterHalf] = await q.rows(`select stripe_charges_enabled as c, stripe_payouts_enabled as p, stripe_details_submitted as d, stripe_requirements_due as due,
                                          stripe_status_at is not null as at, private.cleaner_payable(id) as payable from public.cleaners where id = $1`, [U.alex]);
      await q.rows(`set local role service_role`);
      const ready = await set("acct_TestAlex01", true, true, true, false);
      await q.rows(`reset role`);
      const [afterReady] = await q.rows(`select private.cleaner_payable(id) as payable, stripe_requirements_due as due from public.cleaners where id = $1`, [U.alex]);
      const [audit] = await q.rows<{ actor_label: string }>(`select actor_label from public.audit_log where entity = 'cleaners' and entity_id = $1 order by id desc limit 1`, [U.alex]);
      return { unknown, half, afterHalf, ready, afterReady, audited: audit?.actor_label };
    });
    expect(r).toEqual({
      unknown: "unknown_account",
      half: "updated",
      afterHalf: { c: true, p: false, d: true, due: true, at: true, payable: false },
      ready: "updated",
      afterReady: { payable: true, due: false },
      audited: "stripe-webhook",
    });
  });
});

describe("no payments set-up, no work (C10)", () => {
  it("hides the job board's jobs and refuses a claim, then allows both once Stripe says ready", async () => {
    const r = await setupThen(async (su) => {
      await su.rows(`update public.series set starts_on = private.london_today() where id = $1`, [IDS.benSeries]);
      await su.rows(UNPAYABLE, [U.tara]);
    }, U.tara, async (q) => {
      const board = (await q.rows(`select offer_id from public.job_board()`)).length;
      const claim = await q.attempt(`select public.claim_series(${taraOffer})`);
      await q.rows(`reset role`);
      await q.rows(`update public.cleaners set stripe_charges_enabled = true, stripe_payouts_enabled = true where id = $1`, [U.tara]);
      await q.actAs(U.tara);
      return { board, claim, boardAfter: (await q.rows(`select offer_id from public.job_board()`)).length, claimAfter: await q.attempt(`select public.claim_series(${taraOffer})`) };
    });
    expect(r).toEqual({ board: 0, claim: "PC003", boardAfter: 1, claimAfter: "ok" });
  });

  it("isn't offered new blocks until set-up is finished, and is on the next release after", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`delete from public.job_offers where series_id = $1`, [IDS.benSeries]);
      await q.rows(UNPAYABLE, [U.tara]);
      const offers = async () => (await q.rows(`select 1 from public.job_offers where series_id = $1 and cleaner_id = $2`, [IDS.benSeries, U.tara])).length;
      await q.rows(`select * from private.release_one($1)`, [IDS.benSeries]);
      const before = await offers();
      await q.rows(`update public.cleaners set stripe_charges_enabled = true, stripe_payouts_enabled = true where id = $1`, [U.tara]);
      await q.rows(`select * from private.release_one($1)`, [IDS.benSeries]);
      return { before, after: await offers() };
    });
    expect(r).toEqual({ before: 0, after: 1 });
  });

  it("the admin can't assign a block to a cleaner who can't be paid (PC006)", async () => {
    const r = await setupThen(async (su) => {
      await su.rows(UNPAYABLE, [U.tara]);
    }, U.admin, async (q) => ({
      unpayable: await q.attempt(`select public.admin_assign_series($1, $2)`, [IDS.benSeries, U.tara]),
      payable: await q.attempt(`select public.admin_assign_series($1, $2)`, [IDS.benSeries, U.alex]),
    }));
    expect(r).toEqual({ unpayable: "PC006", payable: "ok" });
  });
});
