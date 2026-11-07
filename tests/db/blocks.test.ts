// Blocks of 1–8 cleans, booking (book_series), and rebooking with first refusal.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { as, CHECK, DENIED, IDS, pool, setupThen, U, type Query } from "./helpers";

afterAll(() => pool.end());

const BOOK = `select public.book_series($1::uuid, $2::public.series_frequency, $3::smallint, $4::time, $5::time,
                                      $6::integer, $7::date, $8::smallint, $9::uuid) as id`;

/** London's date plus n days, as YYYY-MM-DD. */
function london(n: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type Booking = {
  property: string; frequency: string; day: number; from: string; to: string;
  minutes: number; startsIn: number; block: number | null; request: string | null;
};
const booking = (over: Partial<Booking> = {}): unknown[] => {
  const b: Booking = {
    property: IDS.benProperty, frequency: "fortnightly", day: 3, from: "10:00", to: "14:00",
    minutes: 120, startsIn: 1, block: 4, request: randomUUID(), ...over,
  };
  return [b.property, b.frequency, b.day, b.from, b.to, b.minutes, london(b.startsIn), b.block, b.request];
};
const book = async (q: Query, args: unknown[]) => (await q.rows<{ id: string }>(BOOK, args))[0]!.id;

// ---------------------------------------------------------------- the block cap
describe("blocks: never more visits than the block", () => {
  // Ben's series, claimed by Alex, starting tomorrow on tomorrow's weekday.
  const claimBen = (frequency: string, block: number, startsIn = 1, dayOffset = startsIn) => async (su: Query) => {
    await su.rows(`update public.series set status = 'claimed', cleaner_id = $1, claimed_at = now(), offering_since = null,
                   frequency = $2, block_size = $3, starts_on = private.london_today() + $4::int,
                   preferred_day = extract(isodow from private.london_today() + $5::int)::smallint where id = $6`,
                  [U.alex, frequency, block, startsIn, dayOffset, IDS.benSeries]);
  };
  const offsets = (q: Query) =>
    q.rows<{ off: number }>(`select scheduled_date - private.london_today() as off from public.visits where series_id = $1 order by 1`, [IDS.benSeries])
      .then((r) => r.map((x) => x.off));
  const endsOn = (q: Query) =>
    q.rows<{ off: number }>(`select ends_on - private.london_today() as off from public.series where id = $1`, [IDS.benSeries]).then((r) => r[0]!.off);

  it("weekly: a block of 3 is 3 visits however far ahead the horizon reaches, and ends_on is the last", async () => {
    const r = await setupThen(claimBen("weekly", 3), null, async (q) => {
      const [a] = await q.rows<{ n: number }>(`select private.generate_visits_for_series($1, private.london_today() + 365) as n`, [IDS.benSeries]);
      const [b] = await q.rows<{ n: number }>(`select private.generate_visits_for_series($1, private.london_today() + 365) as n`, [IDS.benSeries]);
      return { a: a!.n, b: b!.n, dates: await offsets(q), end: await endsOn(q) };
    });
    expect(r).toEqual({ a: 3, b: 0, dates: [1, 8, 15], end: 15 });
  });

  it("fortnightly: a block of 5 is 5 visits, 14 days apart", async () => {
    const r = await setupThen(claimBen("fortnightly", 5), null, async (q) => {
      await q.rows(`select private.generate_visits_for_series($1, private.london_today() + 365)`, [IDS.benSeries]);
      return { dates: await offsets(q), end: await endsOn(q) };
    });
    expect(r).toEqual({ dates: [1, 15, 29, 43, 57], end: 57 });
  });

  it("caps at 8 for every cadence, and the nightly job never adds more", async () => {
    for (const f of ["weekly", "fortnightly", "four_weekly"]) {
      const n = await setupThen(claimBen(f, 8), null, async (q) => {
        for (let i = 0; i < 3; i++) await q.rows(`select private.generate_visits_for_series($1, private.london_today() + 400)`, [IDS.benSeries]);
        await q.rows(`select private.generate_visits(400)`);
        return q.count(`public.visits where series_id = '${IDS.benSeries}'`);
      });
      expect({ f, n }).toEqual({ f, n: 8 });
    }
  });

  it("books the block gradually inside the 28-day horizon, projecting ends_on until it's all booked", async () => {
    const r = await setupThen(claimBen("weekly", 6), null, async (q) => {
      await q.rows(`select private.generate_visits()`);
      const first = { dates: await offsets(q), end: await endsOn(q) };
      return first;
    });
    expect(r).toEqual({ dates: [1, 8, 15, 22], end: 36 });
  });

  it("slips a block claimed late forward instead of losing cleans", async () => {
    // Booked to start three weeks ago on today's weekday, only claimed now.
    const r = await setupThen(claimBen("weekly", 4, -21, 0), null, async (q) => {
      await q.rows(`select private.generate_visits_for_series($1, private.london_today() + 14)`, [IDS.benSeries]);
      const part = { dates: await offsets(q), end: await endsOn(q) };
      await q.rows(`select private.generate_visits_for_series($1, private.london_today() + 365)`, [IDS.benSeries]);
      return { part, all: { dates: await offsets(q), end: await endsOn(q) } };
    });
    expect(r.part).toEqual({ dates: [7, 14], end: 28 });
    expect(r.all).toEqual({ dates: [7, 14, 21, 28], end: 28 }); // never today, never the past
  });

  it("refuses a block of 0 or 9, in the table and when booking", async () => {
    for (const n of [0, 9]) {
      expect(await as("superuser", (q) => q.attempt(`update public.series set block_size = $1 where id = $2`, [n, IDS.benSeries]))).toBe(CHECK);
      expect(await as("ben", (q) => q.attempt(BOOK, booking({ block: n })))).toBe("PC025");
    }
    expect(await as("ben", (q) => q.attempt(BOOK, booking({ block: null })))).toBe("PC025");
    expect(await as("superuser", (q) => q.attempt(`update public.series set block_size = null where id = $1`, [IDS.benSeries]))).toBe("23502");
  });

  it("ends a block once every clean is done or called off, and the address locks again", async () => {
    const r = await setupThen(async (su) => {
      await su.rows(`update public.series set block_size = 3 where id = $1`, [IDS.annaSeries]);
      await su.rows(`update public.visits set status = 'cancelled', cancelled_at = now() where id in ($1, $2)`, [IDS.visitToday, IDS.visitNextWeek]);
      await su.rows(`select private.generate_visits()`);
    }, U.tara, async (q) => ({
      series: (await q.rows<{ status: string }>(`select status from public.series where id = $1`, [IDS.annaSeries]))[0]!.status,
      properties: await q.count("public.properties"),
    }));
    expect(r).toEqual({ series: "ended", properties: 0 });
  });

  it("leaves a block running while a clean is still to do", async () => {
    const status = await as("superuser", async (q) => {
      await q.rows(`update public.series set block_size = 3 where id = $1`, [IDS.annaSeries]);
      await q.rows(`select private.generate_visits()`);
      return (await q.rows<{ status: string }>(`select status from public.series where id = $1`, [IDS.annaSeries]))[0]!.status;
    });
    expect(status).toBe("claimed");
  });

  it("shows the block on the job board", async () => {
    const [row] = await as("tara", (q) => q.rows<{ block_size: number; span: number; first_refusal: boolean }>(
      `select block_size, ends_on - starts_on as span, first_refusal from public.job_board()`));
    // Ben: 4 fortnightly Wednesdays from the first Wednesday on or after his start date.
    expect(row).toMatchObject({ block_size: 4, first_refusal: false });
    expect(row!.span).toBeGreaterThanOrEqual(42);
    expect(row!.span).toBeLessThanOrEqual(48);
  });
});

// ---------------------------------------------------------------- booking (A-3)
describe("book_series", () => {
  it("books a block at the customer's own home, priced from settings, on offer to the hub", async () => {
    const r = await as("ben", async (q) => {
      const id = await book(q, booking({ block: 4, startsIn: 1, day: 3 }));
      const [s] = await q.rows(`select customer_id, cleaner_id, status, block_size, price_per_hour_pence, commission_type, commission_value,
                                       rebook_of, first_refusal_cleaner_id, ends_on - starts_on as span,
                                       ends_on = (starts_on + ((3 - extract(isodow from starts_on)::int + 7) % 7) + 42) as planned_end
                                from public.series where id = $1`, [id]);
      return s;
    });
    expect(r).toEqual({
      customer_id: U.ben, cleaner_id: null, status: "offering", block_size: 4, price_per_hour_pence: 2000,
      commission_type: "percent", commission_value: 2500, rebook_of: null, first_refusal_cleaner_id: null,
      span: expect.any(Number), planned_end: true,
    });
  });

  it("audits the booking with the customer as the actor", async () => {
    const row = await setupThen(async () => {}, U.ben, async (q) => {
      const id = await book(q, booking());
      await q.rows(`reset role`);
      return (await q.rows<{ actor_id: string; action: string }>(`select actor_id, action from public.audit_log where entity = 'series' and entity_id = $1`, [id]))[0];
    });
    expect(row).toEqual({ actor_id: U.ben, action: "insert" });
  });

  it("takes the price and commission from settings at the moment of booking, never from the browser", async () => {
    const r = await setupThen(async (su) => {
      await su.rows(`update public.settings set price_per_hour_pence = 2400, commission_value = 2000 where id`);
    }, U.ben, async (q) => {
      const id = await book(q, booking());
      const [mine] = await q.rows(`select price_per_hour_pence, commission_value from public.series where id = $1`, [id]);
      await q.actAs(U.anna);
      const [old] = await q.rows(`select price_per_hour_pence, commission_value from public.series where id = $1`, [IDS.annaSeries]);
      return { mine, old };
    });
    expect(r.mine).toEqual({ price_per_hour_pence: 2400, commission_value: 2000 });
    expect(r.old).toEqual({ price_per_hour_pence: 2000, commission_value: 2500 }); // snapshot kept
    // There is no price argument to send: a call with one doesn't exist.
    expect(await as("ben", (q) => q.attempt(
      `select public.book_series($1::uuid, 'weekly', 3::smallint, '10:00', '12:00', 120, current_date + 2, 4::smallint, gen_random_uuid(), 1)`,
      [IDS.benProperty]))).toBe("42883");
  });

  it("is idempotent: the same request id returns the same series, even with changed details", async () => {
    const r = await as("ben", async (q) => {
      const req = randomUUID();
      const a = await book(q, booking({ request: req }));
      const b = await book(q, booking({ request: req }));
      const c = await book(q, booking({ request: req, block: 8, minutes: 240 }));
      const [s] = await q.rows<{ block_size: number }>(`select block_size from public.series where id = $1`, [a]);
      return { same: a === b && b === c, count: await q.count("public.series"), block: s!.block_size };
    });
    expect(r).toEqual({ same: true, count: 2, block: 4 }); // Ben's seeded booking + this one
  });

  it("books once when two taps arrive at the same moment on two connections", async () => {
    const req = randomUUID();
    const tap = async () => {
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.ben, role: "authenticated" })]);
        await c.query(`set local role authenticated`);
        const { rows } = await c.query(BOOK, booking({ request: req }));
        await new Promise((res) => setTimeout(res, 100));
        await c.query("commit");
        return rows[0].id as string;
      } catch (e) {
        await c.query("rollback");
        throw e;
      } finally {
        c.release();
      }
    };
    const ids = await Promise.all([tap(), tap()]);
    try {
      expect(ids[0]).toBe(ids[1]);
      const { rows } = await pool.query(`select count(*)::int as n from public.series where customer_id = $1 and client_request_id = $2`, [U.ben, req]);
      expect(rows[0].n).toBe(1);
    } finally {
      await pool.query(`delete from public.series where customer_id = $1 and client_request_id = $2`, [U.ben, req]);
    }
  });

  it("keeps request ids per customer: another customer's id never returns their booking", async () => {
    const id = await as("ben", (q) => book(q, booking({ request: IDS.annaRequest })));
    expect(id).not.toBe(IDS.annaSeries);
  });

  it("refuses to book while the real prices aren't set, but a retry of a booking already made still answers", async () => {
    for (const col of ["price_per_hour_pence", "min_booking_minutes", "commission_type", "commission_value", "top_window_minutes"]) {
      expect(await setupThen(async (su) => { await su.rows(`update public.settings set ${col} = null where id`); }, U.ben,
        (q) => q.attempt(BOOK, booking()))).toBe("PC020");
    }
    expect(await setupThen(async (su) => { await su.rows(`update public.settings set launch_districts = '{}' where id`); }, U.ben,
      (q) => q.attempt(BOOK, booking()))).toBe("PC020");
    const r = await setupThen(async () => {}, U.ben, async (q) => {
      const req = randomUUID();
      const first = await book(q, booking({ request: req }));
      await q.rows(`reset role`);
      await q.rows(`update public.settings set price_per_hour_pence = null where id`);
      await q.actAs(U.ben);
      return first === (await book(q, booking({ request: req })));
    });
    expect(r).toBe(true);
  });

  it("refuses bad bookings with codes the site can word", async () => {
    const cases: [Partial<Booking>, string][] = [
      [{ property: IDS.annaProperty }, "PC021"],               // someone else's home
      [{ property: randomUUID() }, "PC021"],                   // no such home
      [{ minutes: 90 }, "PC023"],                              // below the minimum (120 in test settings)
      [{ minutes: 135 }, "PC023"],                             // not whole half hours
      [{ minutes: 630 }, "PC023"],                             // over 10 hours
      [{ startsIn: 0 }, "PC024"],                              // today
      [{ startsIn: -3 }, "PC024"],                             // the past
      [{ day: 0 }, "PC026"],
      [{ day: 8 }, "PC026"],
      [{ from: "14:00", to: "10:00" }, "PC026"],
      [{ request: null }, "22004"],
    ];
    for (const [over, code] of cases) {
      expect({ over, code: await as("ben", (q) => q.attempt(BOOK, booking(over))) }).toEqual({ over, code });
    }
  });

  it("refuses a home outside the launch area", async () => {
    const code = await setupThen(async (su) => {
      await su.rows(`update public.properties set postcode = 'CA99 9ZZ' where id = $1`, [IDS.benProperty]);
    }, U.ben, (q) => q.attempt(BOOK, booking()));
    expect(code).toBe("PC022");
  });

  it("is for customers only", async () => {
    for (const who of ["tara", "alex", "sam", "admin", "anon"] as const) {
      expect({ who, code: await as(who, (q) => q.attempt(BOOK, booking())) }).toEqual({ who, code: DENIED });
    }
  });

  it("is still the only way in: customers can't write a series directly", async () => {
    expect(await as("ben", (q) => q.attempt(
      `insert into public.series (property_id, customer_id, frequency, preferred_day, window_start, window_end, duration_minutes,
         price_per_hour_pence, commission_type, commission_value, starts_on, block_size)
       values ($1, $2, 'weekly', 3, '10:00', '12:00', 120, 1, 'percent', 0, current_date + 3, 8)`, [IDS.benProperty, U.ben]))).toBe(DENIED);
    expect(await as("anna", (q) => q.attempt(`update public.series set block_size = 8, first_refusal_cleaner_id = $1`, [U.alex]))).toBe(DENIED);
  });
});

// ---------------------------------------------------------------- rebooking
describe("rebooking: the previous cleaner gets first refusal", () => {
  // Anna's home (CA14) was cleaned by Tara (Top; works Mon, Wed, Fri). Alex is made a Top
  // cleaner who covers CA14 on any day, so he'd be offered it the moment the hub opens.
  const alexCompetes = async (su: Query) => {
    await su.rows(`update public.cleaners set tier = 'top', areas = '{CA14,CA28}', availability = '[]' where id = $1`, [U.alex]);
  };
  const windowOf = (minutes: number | null) => async (su: Query) => {
    await su.rows(`update public.settings set rebook_first_refusal_minutes = $1 where id`, [minutes]);
  };
  const annaRebook = (over: Partial<Booking> = {}) =>
    booking({ property: IDS.annaProperty, frequency: "weekly", day: 1, from: "09:00", to: "12:00", minutes: 150, startsIn: 2, ...over });
  const offers = (q: Query, sid: string) =>
    q.rows<{ cleaner_id: string; first_refusal: boolean }>(
      `select cleaner_id, first_refusal from public.job_offers where series_id = $1 and status = 'open' order by cleaner_id`, [sid]);

  it("window open: only the previous cleaner is offered it; the hub waits", async () => {
    const r = await setupThen(async (su) => { await windowOf(60)(su); await alexCompetes(su); }, U.anna, async (q) => {
      const id = await book(q, annaRebook());
      const [s] = await q.rows<{ rebook_of: string; first_refusal_cleaner_id: string; wait: number }>(
        `select rebook_of, first_refusal_cleaner_id, round(extract(epoch from offering_since - now()) / 60)::int as wait from public.series where id = $1`, [id]);
      await q.rows(`reset role`);
      await q.rows(`select * from private.release_offers()`);
      const during = await offers(q, id);
      await q.actAs(U.alex);
      const alexBoard = await q.rows(`select * from public.job_board() where series_id = $1`, [id]);
      await q.actAs(U.tara);
      const board = await q.rows<{ first_refusal: boolean; town: string }>(`select * from public.job_board() where series_id = $1`, [id]);
      const offerId = (await q.rows<{ offer_id: string }>(`select offer_id from public.job_board() where series_id = $1`, [id]))[0]!.offer_id;
      const claimed = await q.attempt(`select public.claim_series($1)`, [offerId]);
      return { s, during, alexBoard, board, claimed };
    });
    expect(r.s).toEqual({ rebook_of: IDS.annaSeries, first_refusal_cleaner_id: U.tara, wait: 60 });
    expect(r.during).toEqual([{ cleaner_id: U.tara, first_refusal: true }]);
    expect(r.alexBoard).toEqual([]);
    expect(r.board).toHaveLength(1);
    expect(r.board[0]).toMatchObject({ first_refusal: true, town: "Workington" });
    expect(JSON.stringify(r.board)).not.toMatch(/12 Test Street|CA14 9ZZ|4721|Side gate/);
    expect(r.claimed).toBe("ok");
  });

  it("window over: the job goes to the hub as normal", async () => {
    const r = await setupThen(async (su) => { await windowOf(60)(su); await alexCompetes(su); }, U.anna, async (q) => {
      const id = await book(q, annaRebook());
      await q.rows(`reset role`);
      await q.rows(`select * from private.release_offers()`);
      await q.rows(`update public.series set offering_since = now() - interval '1 minute' where id = $1`, [id]);
      await q.rows(`select * from private.release_offers()`);
      return offers(q, id);
    });
    expect(r).toEqual([
      { cleaner_id: U.tara, first_refusal: true },
      { cleaner_id: U.alex, first_refusal: false },
    ].sort((a, b) => a.cleaner_id.localeCompare(b.cleaner_id)));
  });

  it("window setting NULL (the start): straight to the hub, still linked to the previous block", async () => {
    const r = await setupThen(async (su) => { await windowOf(null)(su); await alexCompetes(su); }, U.anna, async (q) => {
      const id = await book(q, annaRebook());
      const [s] = await q.rows<{ rebook_of: string; first_refusal_cleaner_id: string | null; late: boolean }>(
        `select rebook_of, first_refusal_cleaner_id, offering_since > now() as late from public.series where id = $1`, [id]);
      await q.rows(`reset role`);
      await q.rows(`select * from private.release_offers()`);
      return { s, offers: await offers(q, id) };
    });
    expect(r.s).toEqual({ rebook_of: IDS.annaSeries, first_refusal_cleaner_id: null, late: false });
    expect(r.offers.map((o) => o.first_refusal)).toEqual([false, false]);
    expect(r.offers.map((o) => o.cleaner_id).sort()).toEqual([U.tara, U.alex].sort());
  });

  it("previous cleaner no longer eligible (suspended, out of area, or not working that day): straight to the hub", async () => {
    const changes = [
      `update public.cleaners set status = 'suspended' where id = '${U.tara}'`,
      `update public.cleaners set areas = '{CA28}' where id = '${U.tara}'`,
      `update public.profiles set role = 'customer' where id = '${U.tara}'`,
    ];
    for (const change of changes) {
      const r = await setupThen(async (su) => { await windowOf(60)(su); await alexCompetes(su); await su.rows(change); }, U.anna, async (q) => {
        const id = await book(q, annaRebook());
        await q.rows(`reset role`);
        await q.rows(`select * from private.release_offers()`);
        const [s] = await q.rows(`select first_refusal_cleaner_id, offering_since > now() as late from public.series where id = $1`, [id]);
        return { s, offers: await offers(q, id) };
      });
      expect({ change, ...r }).toEqual({ change, s: { first_refusal_cleaner_id: null, late: false }, offers: [{ cleaner_id: U.alex, first_refusal: false }] });
    }
    // Tara doesn't work Tuesdays.
    const tue = await setupThen(async (su) => { await windowOf(60)(su); }, U.anna, async (q) => {
      const id = await book(q, annaRebook({ day: 2 }));
      return (await q.rows<{ fr: string | null }>(`select first_refusal_cleaner_id as fr from public.series where id = $1`, [id]))[0]!.fr;
    });
    expect(tue).toBeNull();
  });

  it("a cleaner suspended during their window can't claim, and doesn't get the address", async () => {
    const r = await setupThen(async (su) => { await windowOf(60)(su); }, U.anna, async (q) => {
      const id = await book(q, annaRebook());
      await q.rows(`reset role`);
      await q.rows(`select * from private.release_offers()`);
      const offerId = (await q.rows<{ id: string }>(`select id from public.job_offers where series_id = $1`, [id]))[0]!.id;
      await q.rows(`update public.cleaners set status = 'suspended' where id = $1`, [U.tara]);
      await q.actAs(U.tara);
      return { claim: await q.attempt(`select public.claim_series($1)`, [offerId]), properties: await q.count("public.properties") };
    });
    expect(r).toEqual({ claim: DENIED, properties: 0 });
  });

  it("keeps the address locked during first refusal until the cleaner claims", async () => {
    // Ben's last block was cleaned by Alex and has ended. Ben books again on a Tuesday (Alex works Tue).
    const r = await setupThen(async (su) => {
      await windowOf(60)(su);
      await su.rows(`update public.series set status = 'ended', cleaner_id = $1, claimed_at = now() - interval '60 days', offering_since = null where id = $2`, [U.alex, IDS.benSeries]);
    }, U.ben, async (q) => {
      const id = await book(q, booking({ day: 2 }));
      await q.rows(`reset role`);
      await q.rows(`select * from private.release_offers()`);
      await q.actAs(U.alex);
      const before = await q.count("public.properties");
      const [offer] = await q.rows<{ offer_id: string; first_refusal: boolean }>(`select offer_id, first_refusal from public.job_board() where series_id = $1`, [id]);
      await q.rows(`select public.claim_series($1)`, [offer!.offer_id]);
      return { before, fr: offer!.first_refusal, after: await q.count("public.properties") };
    });
    expect(r).toEqual({ before: 0, fr: true, after: 1 });
  });

  it("never links a booking to another customer's block", async () => {
    // Ben's home has no previous block with a cleaner, and Anna's series isn't his.
    const r = await setupThen(async (su) => { await windowOf(60)(su); }, U.ben, async (q) => {
      const id = await book(q, booking());
      return (await q.rows(`select rebook_of, first_refusal_cleaner_id from public.series where id = $1`, [id]))[0];
    });
    expect(r).toEqual({ rebook_of: null, first_refusal_cleaner_id: null });
    expect(await as("superuser", (q) => q.attempt(
      `update public.series set rebook_of = $1 where id = $2`, [IDS.annaSeries, IDS.benSeries]))).toBe("23503"); // key: same customer only
  });

  it("lets only admins set the window", async () => {
    expect(await as("anna", (q) => q.attempt(`update public.settings set rebook_first_refusal_minutes = 1 where id`))).toBe("no-rows");
    expect(await as("tara", (q) => q.attempt(`update public.settings set rebook_first_refusal_minutes = 9999 where id`))).toBe("no-rows");
    const row = await as("admin", async (q) => {
      await q.rows(`update public.settings set rebook_first_refusal_minutes = 1440 where id`);
      return (await q.rows(`select actor_id, detail from public.audit_log where entity = 'settings' order by id desc limit 1`))[0];
    });
    expect(row).toEqual({ actor_id: U.admin, detail: { rebook_first_refusal_minutes: { from: null, to: 1440 } } });
    expect(await as("admin", (q) => q.attempt(`update public.settings set rebook_first_refusal_minutes = 0 where id`))).toBe(CHECK);
  });
});

describe("new private engine pieces are out of reach", () => {
  it("can't be called by any signed-in user", async () => {
    for (const sql of [
      `select private.end_block_if_done('${IDS.annaSeries}')`,
      `select private.cleaner_fits('${U.tara}', 'CA14', 1::smallint)`,
      `select * from private.eligible_cleaners('${IDS.benSeries}')`,
      `select private.generate_visits_for_series('${IDS.annaSeries}', current_date + 400)`,
      `select private.next_cadence_after(current_date, 7, current_date)`,
    ]) {
      for (const who of ["anna", "tara", "admin"] as const) {
        expect({ sql, who, code: await as(who, (q) => q.attempt(sql)) }).toEqual({ sql, who, code: DENIED });
      }
    }
  });
});
