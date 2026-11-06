// The marketplace engine: visits from series, tiered offers, the job board, first-to-claim.
import { afterAll, describe, expect, it } from "vitest";
import { as, DENIED, IDS, pool, U, type Query } from "./helpers";

afterAll(() => pool.end());

/** Run as superuser for setup, then switch to a user in the same transaction. */
async function setupThen<T>(setup: (su: Query) => Promise<void>, who: string | null, fn: (q: Query) => Promise<T>) {
  return as("superuser", async (su) => {
    await setup(su);
    if (who) {
      await su.rows(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who, role: "authenticated" })]);
      await su.rows(`set local role authenticated`);
    }
    return fn(su);
  });
}

const ageBen = (minutes: number) => async (su: Query) => {
  await su.rows(`update public.series set offering_since = now() - make_interval(mins => $1) where id = $2`, [minutes, IDS.benSeries]);
};

describe("generate_visits", () => {
  it("fills the next four weeks of a claimed weekly clean, at the snapshot price, and is safe to rerun", async () => {
    const r = await as("superuser", async (q) => {
      const [first] = await q.rows<{ n: number }>(`select private.generate_visits() as n`);
      const [again] = await q.rows<{ n: number }>(`select private.generate_visits() as n`);
      const visits = await q.rows<{ d: string; price_pence: number; ping_fee_pence: number; cleaner_earnings_pence: number; cleaner_id: string }>(
        `select scheduled_date::text as d, price_pence, ping_fee_pence, cleaner_earnings_pence, cleaner_id
         from public.visits where series_id = $1 and scheduled_date > current_date + 7 order by 1`, [IDS.annaSeries]);
      return { first: first!.n, again: again!.n, visits };
    });
    expect(r.first).toBe(3); // +14, +21, +28 (today and +7 already exist)
    expect(r.again).toBe(0);
    expect(r.visits).toHaveLength(3);
    for (const v of r.visits) {
      expect(v).toMatchObject({ price_pence: 5000, ping_fee_pence: 1250, cleaner_earnings_pence: 3750, cleaner_id: U.tara });
    }
  });

  it("follows a fortnightly cadence from the first preferred day on or after the start date", async () => {
    const dates = await as("superuser", async (q) => {
      // Ben's Wednesday fortnightly clean, claimed by Alex, starting next Thursday-ish.
      await q.rows(`update public.series set status = 'claimed', cleaner_id = $1, claimed_at = now(), offering_since = null,
                    starts_on = current_date + 1, preferred_day = extract(isodow from current_date + 3)::smallint where id = $2`, [U.alex, IDS.benSeries]);
      await q.rows(`select private.generate_visits_for_series($1, current_date + 35)`, [IDS.benSeries]);
      return (await q.rows<{ off: number }>(`select scheduled_date - current_date as off from public.visits where series_id = $1 order by 1`, [IDS.benSeries])).map((r) => r.off);
    });
    expect(dates).toEqual([3, 17, 31]);
  });

  it("never creates visits for a paused or ended series, or past its end date", async () => {
    const n = await as("superuser", async (q) => {
      await q.rows(`update public.series set ends_on = current_date + 10 where id = $1`, [IDS.annaSeries]);
      const [a] = await q.rows<{ n: number }>(`select private.generate_visits() as n`);
      await q.rows(`update public.series set status = 'paused' where id = $1`, [IDS.annaSeries]);
      const [b] = await q.rows<{ n: number }>(`select private.generate_visits() as n`);
      return [a!.n, b!.n];
    });
    expect(n).toEqual([0, 0]);
  });

  it("can't be run by signed-in users", async () => {
    expect(await as("admin", (q) => q.attempt(`select private.generate_visits()`))).toBe(DENIED);
  });
});

describe("release_offers: Top first, then Approved, then everyone", () => {
  const offersFor = (q: Query) =>
    q.rows<{ cleaner_id: string; tier: string }>(`select cleaner_id, tier from public.job_offers where series_id = $1 and status = 'open' order by tier`, [IDS.benSeries]);

  it("offers a new job only to Top cleaners in the area at first", async () => {
    const offers = await setupThen(ageBen(30), null, async (q) => {
      await q.rows(`select * from private.release_offers()`);
      return offersFor(q);
    });
    expect(offers).toEqual([{ cleaner_id: U.tara, tier: "top" }]); // Alex (Approved, CA28) waits
  });

  it("opens it to Approved cleaners once the Top window passes", async () => {
    // Alex works Tuesdays and Thursdays; make Ben's clean a Tuesday.
    const offers = await setupThen(async (su) => {
      await ageBen(121)(su);
      await su.rows(`update public.series set preferred_day = 2 where id = $1`, [IDS.benSeries]);
    }, null, async (q) => {
      await q.rows(`select * from private.release_offers()`);
      return offersFor(q);
    });
    expect(offers.map((o) => o.cleaner_id).sort()).toEqual([U.tara, U.alex].sort());
  });

  it("skips cleaners who don't work that day", async () => {
    const offers = await setupThen(async (su) => {
      await ageBen(121)(su);
      await su.rows(`update public.series set preferred_day = 3 where id = $1`, [IDS.benSeries]); // a Wednesday; Alex works Tue/Thu
    }, null, async (q) => {
      await q.rows(`select * from private.release_offers()`);
      return offersFor(q);
    });
    expect(offers.map((o) => o.cleaner_id)).not.toContain(U.alex);
  });

  it("never offers to applicants, suspended cleaners, or cleaners outside the area", async () => {
    const offers = await setupThen(async (su) => {
      await ageBen(5000)(su);
      await su.rows(`update public.cleaners set areas = '{CA28}' where id = $1`, [U.sam]); // applicant
      await su.rows(`update public.cleaners set status = 'suspended' where id = $1`, [U.alex]);
      await su.rows(`update public.cleaners set areas = '{CA14}' where id = $1`, [U.tara]);
      await su.rows(`delete from public.job_offers where series_id = $1`, [IDS.benSeries]);
    }, null, async (q) => {
      await q.rows(`select * from private.release_offers()`);
      return offersFor(q);
    });
    expect(offers).toEqual([]);
  });

  it("flags a job as unclaimed for the admin once every window has passed", async () => {
    const [status] = await setupThen(ageBen(120 + 240 + 720 + 1), null, async (q) => {
      const out = await q.rows<{ now_unclaimed: boolean }>(`select * from private.release_offers()`);
      expect(out.find((o) => o.now_unclaimed)).toBeTruthy();
      return q.rows<{ status: string }>(`select status from public.series where id = $1`, [IDS.benSeries]);
    });
    expect(status!.status).toBe("unclaimed");
  });

  it("does nothing at all while the real prices and windows aren't set", async () => {
    const out = await setupThen(async (su) => {
      await ageBen(500)(su);
      await su.rows(`update public.settings set top_window_minutes = null where id`);
    }, null, async (q) => {
      const rows = await q.rows(`select * from private.release_offers()`);
      return { rows, offers: await offersFor(q) };
    });
    expect(out.rows).toEqual([]);
    expect(out.offers).toEqual([{ cleaner_id: U.tara, tier: "top" }]); // only the seeded one
  });
});

describe("job_board", () => {
  it("shows a cleaner their open offers with town and district only, never the address", async () => {
    const rows = await as("tara", (q) => q.rows(`select * from public.job_board()`));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      series_id: IDS.benSeries, town: "Whitehaven", postcode_district: "CA28", bedrooms: 2,
      has_pets: false, earnings_per_visit_pence: 3000, offered_as: "top",
    });
    const json = JSON.stringify(rows);
    expect(json).not.toMatch(/Sample Road|CA28 9ZZ|Ring the bell/);
    expect(Object.keys(rows[0]!)).not.toEqual(expect.arrayContaining(["address_line1", "postcode", "access_notes", "key_code"]));
  });

  it("is empty for a cleaner with no offers, and refused to non-cleaners", async () => {
    expect(await as("alex", (q) => q.rows(`select * from public.job_board()`))).toEqual([]);
    expect(await as("anna", (q) => q.attempt(`select * from public.job_board()`))).toBe(DENIED);
    expect(await as("sam", (q) => q.attempt(`select * from public.job_board()`))).toBe(DENIED);
    expect(await as("anon", (q) => q.attempt(`select * from public.job_board()`))).toBe(DENIED);
  });
});

describe("claim_series", () => {
  const taraOffer = `(select id from public.job_offers where series_id = '${IDS.benSeries}' and cleaner_id = '${U.tara}')`;

  it("gives the job to the cleaner, unlocks the address, withdraws other offers and books visits", async () => {
    const r = await setupThen(async (su) => {
      await su.rows(`insert into public.job_offers (series_id, cleaner_id, tier, opens_at, status) values ($1, $2, 'approved', now(), 'open')`, [IDS.benSeries, U.alex]);
      await su.rows(`update public.series set starts_on = current_date where id = $1`, [IDS.benSeries]);
    }, U.tara, async (q) => {
      const before = await q.count("public.properties");
      const [{ claim_series }] = (await q.rows<{ claim_series: string }>(`select public.claim_series(${taraOffer})`)) as [{ claim_series: string }];
      const [series] = await q.rows<{ status: string; cleaner_id: string }>(`select status, cleaner_id from public.series where id = $1`, [IDS.benSeries]);
      const [addr] = await q.rows<{ address_line1: string }>(`select address_line1 from public.properties where id = $1`, [IDS.benProperty]);
      const visits = await q.count(`public.visits where series_id = '${IDS.benSeries}'`);
      const offers = await q.rows<{ cleaner_id: string; status: string }>(`select cleaner_id, status from public.job_offers where series_id = $1`, [IDS.benSeries]);
      return { before, claim_series, series, addr, visits, offers };
    });
    expect(r.claim_series).toBe(IDS.benSeries);
    expect(r.series).toEqual({ status: "claimed", cleaner_id: U.tara });
    expect(r.before).toBe(1); // only Anna's, before claiming
    expect(r.addr?.address_line1).toBe("8 Sample Road");
    expect(r.visits).toBeGreaterThanOrEqual(2);
    expect(r.offers).toEqual(expect.arrayContaining([{ cleaner_id: U.tara, status: "claimed" }]));
    // Alex's offer was withdrawn (checked as superuser below, since Alex's row isn't Tara's to see)
  });

  it("tells a cleaner who lost a race that someone else got it first", async () => {
    const code = await setupThen(async (su) => {
      await su.rows(`insert into public.job_offers (series_id, cleaner_id, tier, opens_at, status) values ($1, $2, 'approved', now(), 'open')`, [IDS.benSeries, U.alex]);
      await su.rows(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.tara, role: "authenticated" })]);
      await su.rows(`set local role authenticated`);
      await su.rows(`select public.claim_series(${taraOffer})`);
      await su.rows(`reset role`);
    }, U.alex, (q) => q.attempt(`select public.claim_series((select id from public.job_offers where series_id = '${IDS.benSeries}' and cleaner_id = '${U.alex}'))`));
    expect(code).toBe("PC002");
  });

  it("refuses someone else's offer, a closed offer, and suspended cleaners", async () => {
    expect(await as("alex", (q) => q.attempt(`select public.claim_series(${taraOffer})`))).toBe("PC001");
    expect(await setupThen(async (su) => { await su.rows(`update public.job_offers set status = 'withdrawn' where cleaner_id = $1`, [U.tara]); }, U.tara,
      (q) => q.attempt(`select public.claim_series(${taraOffer})`))).toBe("PC003");
    expect(await setupThen(async (su) => { await su.rows(`update public.cleaners set status = 'suspended' where id = $1`, [U.tara]); }, U.tara,
      (q) => q.attempt(`select public.claim_series(${taraOffer})`))).toBe(DENIED);
  });

  it("lets exactly one of two cleaners claim when they press at the same moment", async () => {
    // Real race: two connections, committed setup, both claim concurrently.
    const setup = await pool.connect();
    try {
      await setup.query(`insert into public.job_offers (series_id, cleaner_id, tier, opens_at, status) values ($1, $2, 'approved', now(), 'open') on conflict do nothing`, [IDS.benSeries, U.alex]);
      const claim = async (who: string) => {
        const c = await pool.connect();
        try {
          await c.query("begin");
          await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who, role: "authenticated" })]);
          await c.query(`set local role authenticated`);
          await c.query(`select public.claim_series((select id from public.job_offers where series_id = $1 and cleaner_id = $2))`, [IDS.benSeries, who]);
          await new Promise((r) => setTimeout(r, 150)); // hold the lock so the other really waits
          await c.query("commit");
          return "won";
        } catch (e) {
          await c.query("rollback");
          return (e as { code?: string }).code;
        } finally {
          c.release();
        }
      };
      const results = await Promise.all([claim(U.tara), claim(U.alex)]);
      expect(results.sort()).toEqual(["PC002", "won"]);
      const { rows } = await setup.query(`select count(*)::int as n from public.job_offers where series_id = $1 and status = 'claimed'`, [IDS.benSeries]);
      expect(rows[0].n).toBe(1);
    } finally {
      // Put the seed back for the other tests in this run.
      await setup.query(`delete from public.visits where series_id = $1`, [IDS.benSeries]);
      await setup.query(`update public.series set status = 'offering', cleaner_id = null, claimed_at = null, offering_since = now() - interval '30 minutes' where id = $1`, [IDS.benSeries]);
      await setup.query(`delete from public.job_offers where series_id = $1 and cleaner_id = $2`, [IDS.benSeries, U.alex]);
      await setup.query(`update public.job_offers set status = 'open', responded_at = null where series_id = $1 and cleaner_id = $2`, [IDS.benSeries, U.tara]);
      setup.release();
    }
  });
});

describe("admin_assign_series", () => {
  it("lets an admin give an open job to an active cleaner, and nobody else", async () => {
    expect(await as("tara", (q) => q.attempt(`select public.admin_assign_series($1, $2)`, [IDS.benSeries, U.tara]))).toBe(DENIED);
    const r = await as("admin", async (q) => {
      await q.rows(`select public.admin_assign_series($1, $2)`, [IDS.benSeries, U.alex]);
      const [s] = await q.rows<{ status: string; cleaner_id: string }>(`select status, cleaner_id from public.series where id = $1`, [IDS.benSeries]);
      const offers = await q.rows<{ cleaner_id: string; status: string }>(`select cleaner_id, status from public.job_offers where series_id = $1 order by status`, [IDS.benSeries]);
      const [audit] = await q.rows<{ actor_id: string }>(`select actor_id from public.audit_log where entity = 'series' and entity_id = $1 order by id desc limit 1`, [IDS.benSeries]);
      return { s, offers, audit };
    });
    expect(r.s).toEqual({ status: "claimed", cleaner_id: U.alex });
    expect(r.offers).toEqual([{ cleaner_id: U.alex, status: "claimed" }, { cleaner_id: U.tara, status: "withdrawn" }]);
    expect(r.audit?.actor_id).toBe(U.admin);
  });

  it("won't assign to an applicant", async () => {
    expect(await as("admin", (q) => q.attempt(`select public.admin_assign_series($1, $2)`, [IDS.benSeries, U.sam]))).toBe("PC001");
  });
});
