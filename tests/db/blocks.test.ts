// Blocks of 1–8 cleans, booking (book_series), and rebooking with first refusal.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    // Starts after Ben's seeded block (on offer, ends within ~55 days): one block at a time per home.
    property: IDS.benProperty, frequency: "fortnightly", day: 3, from: "10:00", to: "14:00",
    minutes: 120, startsIn: 70, block: 4, request: randomUUID(), ...over,
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
// While a block at a home is waiting for a cleaner, no new block can be booked there. Ben's
// seeded block is on offer, so for these tests it's held by Alex (committed, put back after).
const holdBen = () => pool.query(`update public.series set status = 'claimed', cleaner_id = $1, claimed_at = now(), offering_since = null where id = $2`, [U.alex, IDS.benSeries]);
const releaseBen = () => pool.query(`update public.series set status = 'offering', cleaner_id = null, claimed_at = null, offering_since = now() - interval '30 minutes' where id = $1`, [IDS.benSeries]);

describe("book_series", () => {
  beforeAll(holdBen);
  afterAll(releaseBen);

  it("refuses a new block while one at that home is still waiting for a cleaner, whatever the dates (re-review)", async () => {
    for (const status of ["offering", "unclaimed"]) {
      expect(await setupThen(async (su) => {
        await su.rows(`update public.series set status = $1::public.series_status, cleaner_id = null, claimed_at = null, offering_since = now() where id = $2`, [status, IDS.benSeries]);
      }, U.ben, (q) => q.attempt(BOOK, booking({ startsIn: 300 })))).toBe("PC027");
    }
  });

  it("answers a same-id race for two different homes with the booking or PC028, never a raw error (re-review)", async () => {
    const home2 = "00000000-0000-4000-b000-0000000000a2";
    await pool.query(`insert into public.properties (id, customer_id, address_line1, town, postcode, bedrooms, bathrooms)
                      values ($1, $2, '14 Test Street', 'Workington', 'CA14 9ZY', 2, 1)`, [home2, U.anna]);
    const req = randomUUID();
    const tap = async (property: string) => {
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.anna, role: "authenticated" })]);
        await c.query(`set local role authenticated`);
        await c.query(BOOK, booking({ property, frequency: "weekly", day: 1, from: "09:00", to: "12:00", minutes: 150, startsIn: 60, request: req }));
        await new Promise((res) => setTimeout(res, 100));
        await c.query("commit");
        return "ok";
      } catch (e) {
        await c.query("rollback");
        return (e as { code?: string }).code;
      } finally {
        c.release();
      }
    };
    try {
      expect((await Promise.all([tap(IDS.annaProperty), tap(home2)])).sort()).toEqual(["PC028", "ok"]);
    } finally {
      await pool.query(`delete from public.series where customer_id = $1 and client_request_id = $2`, [U.anna, req]);
      await pool.query(`delete from public.properties where id = $1`, [home2]);
    }
  });

  it("books a block at the customer's own home, priced from settings, on offer to the hub", async () => {
    const r = await as("ben", async (q) => {
      const id = await book(q, booking({ block: 4, day: 3 }));
      const [s] = await q.rows(`select customer_id, cleaner_id, status, block_size, price_per_hour_pence, commission_type, commission_value,
                                       rebook_of, first_refusal_cleaner_id, ends_on - starts_on as span,
                                       ends_on = (starts_on + ((3 - extract(isodow from starts_on)::int + 7) % 7) + 42) as planned_end
                                from public.series where id = $1`, [id]);
      return s;
    });
    expect(r).toEqual({
      customer_id: U.ben, cleaner_id: null, status: "offering", block_size: 4, price_per_hour_pence: 2000,
      // Ben's earlier block (held by Alex here) is linked; the window setting is unset, so no first refusal.
      commission_type: "percent", commission_value: 2500, rebook_of: IDS.benSeries, first_refusal_cleaner_id: null,
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

  it("is idempotent: the same request id returns the same series", async () => {
    const r = await as("ben", async (q) => {
      const req = randomUUID();
      const a = await book(q, booking({ request: req }));
      const b = await book(q, booking({ request: req }));
      return { same: a === b, count: await q.count("public.series") };
    });
    expect(r).toEqual({ same: true, count: 2 }); // Ben's seeded booking + this one
  });

  it("refuses the same request id with different details instead of quietly answering the first booking (review)", async () => {
    const r = await as("ben", async (q) => {
      const req = randomUUID();
      await book(q, booking({ request: req }));
      return {
        block: await q.attempt(BOOK, booking({ request: req, block: 8 })),
        length: await q.attempt(BOOK, booking({ request: req, minutes: 240 })),
        day: await q.attempt(BOOK, booking({ request: req, day: 4 })),
        count: await q.count("public.series"),
      };
    });
    expect(r).toEqual({ block: "PC028", length: "PC028", day: "PC028", count: 2 });
  });

  it("refuses a time window shorter than the clean (review)", async () => {
    expect(await as("ben", (q) => q.attempt(BOOK, booking({ from: "10:00", to: "11:30", minutes: 120 })))).toBe("PC026");
    expect(await as("ben", (q) => q.attempt(BOOK, booking({ from: "10:00", to: "12:00", minutes: 120 })))).toBe("ok");
  });

  it("allows one block at a time per home: overlapping dates are refused (review)", async () => {
    // Ben's seeded block (fortnightly Wednesdays from next week) is still on offer.
    expect(await as("ben", (q) => q.attempt(BOOK, booking({ startsIn: 1 })))).toBe("PC027");
    expect(await as("ben", (q) => q.attempt(BOOK, booking({ startsIn: 1, frequency: "weekly", day: 5, block: 1 })))).toBe("ok"); // before it starts
    const r = await as("ben", async (q) => {
      const a = await q.attempt(BOOK, booking({ startsIn: 70 }));
      const b = await q.attempt(BOOK, booking({ startsIn: 80 })); // overlaps the one just made
      return { a, b, count: await q.count("public.series") };
    });
    expect(r).toEqual({ a: "ok", b: "PC027", count: 2 });
    for (const status of ["unclaimed", "paused"]) {
      expect(await setupThen(async (su) => {
        await su.rows(`update public.series set status = $1::public.series_status, cleaner_id = case when $1::text = 'paused' then $2::uuid end,
                       offering_since = case when $1::text = 'paused' then null else now() end where id = $3`, [status, U.alex, IDS.benSeries]);
      }, U.ben, (q) => q.attempt(BOOK, booking({ startsIn: 1 })))).toBe("PC027");
    }
  });

  it("still lets a customer rebook the same dates once the old block has ended", async () => {
    expect(await setupThen(async (su) => {
      await su.rows(`update public.series set status = 'ended' where id = $1`, [IDS.benSeries]);
    }, U.ben, (q) => q.attempt(BOOK, booking({ startsIn: 1 })))).toBe("ok");
  });

  it("books once when two different requests for overlapping dates race (property lock)", async () => {
    const tap = async () => {
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.ben, role: "authenticated" })]);
        await c.query(`set local role authenticated`);
        await c.query(BOOK, booking({ startsIn: 90 }));
        await new Promise((res) => setTimeout(res, 100));
        await c.query("commit");
        return "ok";
      } catch (e) {
        await c.query("rollback");
        return (e as { code?: string }).code;
      } finally {
        c.release();
      }
    };
    const results = await Promise.all([tap(), tap()]);
    try {
      expect(results.sort()).toEqual(["PC027", "ok"]);
    } finally {
      await pool.query(`delete from public.series where customer_id = $1 and id <> $2`, [U.ben, IDS.benSeries]);
    }
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
    // After Anna's current block (last clean in ~6 weeks): a rebook can't overlap it.
    booking({ property: IDS.annaProperty, frequency: "weekly", day: 1, from: "09:00", to: "12:00", minutes: 150, startsIn: 50, ...over });
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
    const r = await setupThen(async (su) => {
      await windowOf(60)(su);
      await su.rows(`update public.series set status = 'ended' where id = $1`, [IDS.benSeries]); // never had a cleaner
    }, U.ben, async (q) => {
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

// ---------------------------------------------------------------- independent review fixes
describe("review: a block can't stay open forever", () => {
  // Anna's block of 2: last week's clean was done; yesterday's was never started.
  const pastBlock = (yesterdayStatus: "scheduled" | "in_progress") => async (su: Query) => {
    await su.rows(`update public.series set block_size = 2 where id = $1`, [IDS.annaSeries]);
    await su.rows(`delete from public.visits where id = $1`, [IDS.visitNextWeek]);
    await su.rows(`update public.visits set scheduled_date = private.london_today() - 1, status = $2::public.visit_status,
                   started_at = case when $2::text = 'in_progress' then now() - interval '1 day' end where id = $1`, [IDS.visitToday, yesterdayStatus]);
  };
  const nightly = async (q: Query, how: "function" | "procedure") => {
    if (how === "function") await q.rows(`select private.generate_visits()`);
    else { await q.rows(`call private.run_generate_visits()`); await q.rows(`reset search_path`); }
  };

  it("marks a clean that never happened as a no-show, tells the admin, ends the block and locks the address", async () => {
    const r = await setupThen(pastBlock("scheduled"), null, async (q) => {
      await nightly(q, "function");
      const [v] = await q.rows<{ status: string }>(`select status from public.visits where id = $1`, [IDS.visitToday]);
      const alerts = await q.rows(`select kind, visit_id from public.engine_alerts`);
      const [s] = await q.rows<{ status: string }>(`select status from public.series where id = $1`, [IDS.annaSeries]);
      await q.actAs(U.tara);
      return { visit: v!.status, alerts, series: s!.status, properties: await q.count("public.properties"),
               noShows: (await q.rows<{ no_shows: number }>(`select no_shows from public.cleaners where id = $1`, [U.tara]))[0]!.no_shows };
    });
    expect(r).toEqual({ visit: "no_show", alerts: [{ kind: "visit_no_show", visit_id: IDS.visitToday }], series: "ended", properties: 0, noShows: 0 });
  });

  it("flags a clean started but never finished, once, and still ends the block", async () => {
    const r = await setupThen(pastBlock("in_progress"), null, async (q) => {
      await nightly(q, "function");
      await nightly(q, "function");
      const [v] = await q.rows<{ status: string }>(`select status from public.visits where id = $1`, [IDS.visitToday]);
      const alerts = await q.rows(`select kind, visit_id from public.engine_alerts`);
      const [s] = await q.rows<{ status: string }>(`select status from public.series where id = $1`, [IDS.annaSeries]);
      return { visit: v!.status, alerts, series: s!.status };
    });
    expect(r).toEqual({ visit: "in_progress", alerts: [{ kind: "visit_unfinished", visit_id: IDS.visitToday }], series: "ended" });
  });

  it("does the same on the scheduler's procedure", async () => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await pastBlock("scheduled")({
        rows: async (sql: string, p?: unknown[]) => (await c.query(sql, p)).rows,
      } as unknown as Query);
      await c.query("commit");
      await c.query(`call private.run_generate_visits()`);
      await c.query(`reset search_path`);
      const { rows } = await c.query(`select status from public.series where id = $1`, [IDS.annaSeries]);
      expect(rows[0].status).toBe("ended");
    } finally {
      // Put the seed back for the other tests in this run.
      await c.query(`reset search_path`);
      await c.query(`delete from public.engine_alerts`);
      await c.query(`update public.series set status = 'claimed', block_size = 8 where id = $1`, [IDS.annaSeries]);
      await c.query(`update public.visits set scheduled_date = (now() at time zone 'Europe/London')::date, status = 'scheduled', started_at = null where id = $1`, [IDS.visitToday]);
      await c.query(`insert into public.visits (id, series_id, customer_id, cleaner_id, scheduled_date, window_start, window_end, duration_minutes,
                       price_pence, cleaner_earnings_pence, ping_fee_pence)
                     values ($1, $2, $3, $4, (now() at time zone 'Europe/London')::date + 7, '09:00', '12:00', 150, 5000, 3750, 1250)
                     on conflict do nothing`, [IDS.visitNextWeek, IDS.annaSeries, U.anna, U.tara]);
      await c.query(`delete from public.visits where series_id = $1 and id not in ($2, $3, $4)`, [IDS.annaSeries, IDS.visitDone, IDS.visitToday, IDS.visitNextWeek]);
      c.release();
    }
  });

  it("leaves a block with a clean still to come alone", async () => {
    const status = await as("superuser", async (q) => {
      await q.rows(`select private.generate_visits()`);
      return (await q.rows<{ status: string }>(`select status from public.series where id = $1`, [IDS.annaSeries]))[0]!.status;
    });
    expect(status).toBe("claimed");
  });
});

describe("review: a job that changes hands takes today's clean with it", () => {
  it("admin assigns after a drop-out: today's clean moves to the new cleaner, who can start it; the old one can't", async () => {
    const r = await setupThen(async () => {}, U.admin, async (q) => {
      await q.rows(`select public.admin_reopen_series($1)`, [IDS.annaSeries]);
      await q.rows(`select public.admin_assign_series($1, $2)`, [IDS.annaSeries, U.alex]);
      const [v] = await q.rows<{ cleaner_id: string; status: string }>(`select cleaner_id, status from public.visits where id = $1`, [IDS.visitToday]);
      const done = await q.rows<{ cleaner_id: string }>(`select cleaner_id from public.visits where id = $1`, [IDS.visitDone]);
      await q.actAs(U.tara);
      const tara = await q.attempt(`select public.start_visit($1)`, [IDS.visitToday]);
      await q.actAs(U.alex);
      const alex = await q.attempt(`select public.start_visit($1)`, [IDS.visitToday]);
      return { v, done: done[0]!.cleaner_id, tara, alex };
    });
    expect(r).toEqual({ v: { cleaner_id: U.alex, status: "scheduled" }, done: U.tara, tara: "PC010", alex: "ok" });
  });

  it("a cleaner claiming it off the board gets today's clean too", async () => {
    const r = await setupThen(async (su) => {
      await su.rows(`update public.cleaners set areas = '{CA14,CA28}', availability = '[]' where id = $1`, [U.alex]);
      await su.rows(`select private.reopen_series($1)`, [IDS.annaSeries]);
      await su.rows(`update public.series set offering_since = now() - interval '3 hours' where id = $1`, [IDS.annaSeries]);
      await su.rows(`select * from private.release_offers()`);
    }, U.alex, async (q) => {
      const [offer] = await q.rows<{ offer_id: string }>(`select offer_id from public.job_board() where series_id = $1`, [IDS.annaSeries]);
      await q.rows(`select public.claim_series($1)`, [offer!.offer_id]);
      return (await q.rows<{ cleaner_id: string }>(`select cleaner_id from public.visits where id = $1`, [IDS.visitToday]))[0]!.cleaner_id;
    });
    expect(r).toBe(U.alex);
  });
});

describe("review: the job board only shows what the cleaner can claim now", () => {
  it("hides an offer whose tier window isn't open to them any more", async () => {
    const rows = await setupThen(async (su) => {
      await su.rows(`update public.cleaners set tier = 'new' where id = $1`, [U.tara]); // demoted inside the Top window
    }, U.tara, (q) => q.rows(`select * from public.job_board()`));
    expect(rows).toEqual([]);
    expect(await as("tara", (q) => q.count(`public.job_board()`))).toBe(1);
  });
});

describe("review: trigger helpers aren't callable", () => {
  it("revokes the checklist time-stamp function from everyone", async () => {
    const [r] = await as("superuser", (q) => q.rows(`select has_function_privilege('authenticated', 'private.stamp_checklist_tick()', 'execute') as authed,
                                                        has_function_privilege('anon', 'private.stamp_checklist_tick()', 'execute') as anon`));
    expect(r).toEqual({ authed: false, anon: false });
  });
});

// ---------------------------------------------------------------- re-review fixes
describe("re-review: a block that slips never runs into the next one at the same home", () => {
  const fakeToday = (q: Query, sqlDate: string) =>
    q.rows(`create or replace function private.london_today() returns date language sql stable set search_path = '' as $$ select ${sqlDate} $$`);
  const n = async (q: Query, sql: string, params: unknown[] = []) => (await q.rows<{ n: number }>(sql, params))[0]!.n;

  it("z1: block A claimed, B booked after it, A dropped and re-assigned a month late: no clean is double-booked", async () => {
    const r = await as("superuser", async (q) => {
      // Block A = Ben's 4 fortnightly Wednesdays, held by Tara.
      await q.actAs(U.admin);
      await q.rows(`select public.admin_assign_series($1, $2)`, [IDS.benSeries, U.tara]);
      await q.rows(`reset role`);
      const aEnd = await n(q, `select ends_on - private.london_today() as n from public.series where id = $1`, [IDS.benSeries]);
      // Ben books block B (weekly Wednesdays) to start the day after A's last clean.
      await q.actAs(U.ben);
      const b = await book(q, booking({ frequency: "weekly", day: 3, startsIn: aEnd + 1, block: 4 }));
      // Tara drops out; nobody takes A for a month; then A and B are both assigned.
      await q.actAs(U.admin);
      await q.rows(`select public.admin_reopen_series($1)`, [IDS.benSeries]);
      await q.rows(`reset role`);
      await fakeToday(q, `(now() at time zone 'Europe/London')::date + 30`);
      await q.actAs(U.admin);
      await q.rows(`select public.admin_assign_series($1, $2)`, [IDS.benSeries, U.tara]);
      await q.rows(`select public.admin_assign_series($1, $2)`, [b, U.alex]);
      await q.rows(`reset role`);
      for (const sid of [IDS.benSeries, b]) await q.rows(`select private.generate_visits_for_series($1, private.london_today() + 400)`, [sid]);

      const doubled = await q.rows(`select v.scheduled_date from public.visits v join public.series s on s.id = v.series_id
                                    where s.property_id = $1 group by 1 having count(*) > 1`, [IDS.benProperty]);
      const aLast = await q.rows<{ last: string; ends: string; bFirst: string; aCount: number; bCount: number }>(
        `select (select max(scheduled_date)::text from public.visits where series_id = $1) as last,
                (select ends_on::text from public.series where id = $1) as ends,
                (select min(scheduled_date)::text from public.visits where series_id = $2) as "bFirst",
                (select count(*)::int from public.visits where series_id = $1) as "aCount",
                (select count(*)::int from public.visits where series_id = $2) as "bCount"`, [IDS.benSeries, b]);
      const alerts = await q.rows(`select kind, series_id from public.engine_alerts where kind = 'block_overlap'`);

      // Time passes beyond A's last clean, which was done: A ends and Tara loses the address.
      await fakeToday(q, `date '${aLast[0]!.ends}' + 1`);
      await q.rows(`update public.visits set status = 'completed', started_at = now(), completed_at = now() where series_id = $1`, [IDS.benSeries]);
      const ended = (await q.rows<{ e: boolean }>(`select private.end_block_if_done($1) as e`, [IDS.benSeries]))[0]!.e;
      await q.actAs(U.tara);
      const taraSees = await q.count(`public.properties where id = '${IDS.benProperty}'`);
      return { doubled, a: aLast[0]!, alerts, ended, taraSees };
    });
    expect(r.doubled).toEqual([]);
    expect(r.a.last < r.a.bFirst).toBe(true);
    expect(r.a.ends).toBe(r.a.last);   // A's end moved back to its last clean
    expect(r.a.aCount).toBeLessThan(4); // cut short, not double-booked
    expect(r.a.bCount).toBe(4);         // the later block is untouched
    expect(r.alerts).toEqual([{ kind: "block_overlap", series_id: IDS.benSeries }]);
    expect(r.ended).toBe(true);
    expect(r.taraSees).toBe(0);
  });
});

// ---------------------------------------------------------------- final review: authoritative block dates
describe("final review: a held block's dates are real, and only an explicit cut makes it short", () => {
  const fakeToday = (q: Query, sqlDate: string) =>
    q.rows(`create or replace function private.london_today() returns date language sql stable set search_path = '' as $$ select ${sqlDate} $$`);
  const one = async <T>(q: Query, sql: string, params: unknown[] = []) => (await q.rows<{ v: T }>(sql, params))[0]!.v;
  // Days from the real London date (booking() builds its dates from the real date too).
  const dayOffset = (q: Query, d: string) => one<number>(q, `select ($1::date - (now() at time zone 'Europe/London')::date) as v`, [d]);

  it("claiming books the whole block at once, beyond the 28-day horizon, and ends_on is its real last clean", async () => {
    const r = await setupThen(async () => {}, U.tara, async (q) => {
      const [o] = await q.rows<{ offer_id: string }>(`select offer_id from public.job_board()`);
      await q.rows(`select public.claim_series($1)`, [o!.offer_id]);
      await q.rows(`reset role`);
      return q.rows(`select (select count(*)::int from public.visits where series_id = s.id) as n,
                            (select max(scheduled_date) from public.visits where series_id = s.id) = s.ends_on as real_end,
                            (select max(scheduled_date) from public.visits where series_id = s.id) - private.london_today() > 28 as beyond
                     from public.series s where s.id = $1`, [IDS.benSeries]);
    });
    expect(r[0]).toEqual({ n: 4, real_end: true, beyond: true });
  });

  it("r3: a customer can't book into a held block's dates, and a block in the gap after a cut one changes nothing", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.series set status = 'ended' where id = $1`, [IDS.benSeries]);
      await q.rows(`update public.cleaners set availability = '[]'`);
      // Block A: 8 weekly Wednesdays, held by Tara: all 8 booked now.
      await q.actAs(U.ben);
      const a = await book(q, booking({ frequency: "weekly", day: 3, startsIn: 3, block: 8 }));
      await q.actAs(U.admin);
      await q.rows(`select public.admin_assign_series($1, $2)`, [a, U.tara]);
      const aEnd = await one<string>(q, `select ends_on::text as v from public.series where id = $1`, [a]);
      // Truncation attempt 1: a 1-clean block inside A's dates.
      await q.actAs(U.ben);
      const inside = await q.attempt(BOOK, booking({ frequency: "weekly", day: 3, startsIn: 20, block: 1 }));
      // Block B (1 clean) right after A, held by Tara too.
      const b = await book(q, booking({ frequency: "weekly", day: 3, startsIn: (await dayOffset(q, aEnd)) + 1, block: 1 }));
      await q.actAs(U.admin);
      await q.rows(`select public.admin_assign_series($1, $2)`, [b, U.tara]);
      // Tara drops A a few days in; Alex takes it two weeks later, so it slips into B.
      await q.rows(`reset role`);
      await fakeToday(q, `(now() at time zone 'Europe/London')::date + 3`);
      await q.rows(`select private.reopen_series($1)`, [a]);
      await fakeToday(q, `(now() at time zone 'Europe/London')::date + 17`);
      await q.actAs(U.admin);
      await q.rows(`select public.admin_assign_series($1, $2)`, [a, U.alex]);
      await q.rows(`reset role`);
      const cut = await q.rows<{ n: number; cut: number; last: string; ends: string; bFirst: string; msg: string }>(
        `select (select count(*)::int from public.visits where series_id = $1) as n, s.cut_short_cleans as cut,
                (select max(scheduled_date)::text from public.visits where series_id = $1) as last, s.ends_on::text as ends,
                (select min(scheduled_date)::text from public.visits where series_id = $2) as "bFirst",
                (select message from public.engine_alerts where series_id = $1 and kind = 'block_overlap') as msg
         from public.series s where s.id = $1`, [a, b]);
      // Truncation attempt 2: a 1-clean Friday block in the gap between A's last clean and B.
      const gapDay = await one<number>(q, `select extract(isodow from $1::date + 2)::int as v`, [cut[0]!.last]);
      await q.actAs(U.ben);
      const gap = await q.attempt(BOOK, booking({ frequency: "weekly", day: gapDay, startsIn: (await dayOffset(q, cut[0]!.last)) + 1, block: 1 }));
      await q.rows(`reset role`);
      await fakeToday(q, `(now() at time zone 'Europe/London')::date + 24`);
      await q.rows(`select private.generate_visits()`);
      const after = await q.rows(`select (select count(*)::int from public.visits where series_id = $1) as n, cut_short_cleans as cut, ends_on::text as ends
                                  from public.series where id = $1`, [a]);
      return { inside, cut: cut[0]!, gap, after: after[0] };
    });
    expect(r.inside).toBe("PC027");
    expect(r.cut.last < r.cut.bFirst).toBe(true);
    expect(r.cut.ends).toBe(r.cut.last);
    expect(r.cut.n + r.cut.cut).toBe(8);                         // every clean accounted for, exactly
    expect(r.cut.msg).toContain(`so ${r.cut.cut} of its cleans`); // the alert says exactly how many
    expect(r.gap).toBe("ok");                                     // allowed, and harmless:
    expect(r.after).toEqual({ n: r.cut.n, cut: r.cut.cut, ends: r.cut.ends });
  });

  it("r4: a block whose cleaner was suspended is never ended short silently: the admin is told, once", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.cleaners set status = 'suspended' where id = $1`, [U.tara]);
      await fakeToday(q, `(select ends_on + 1 from public.series where id = '${IDS.annaSeries}')`);
      await q.rows(`select private.generate_visits()`);
      await q.rows(`select private.generate_visits()`);
      return {
        status: await one<string>(q, `select status::text as v from public.series where id = $1`, [IDS.annaSeries]),
        alerts: await q.rows<{ message: string }>(`select message from public.engine_alerts where kind = 'block_stalled' and series_id = $1`, [IDS.annaSeries]),
      };
    });
    expect(r.status).toBe("claimed");
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]!.message).toContain("only 3 of its 8 cleans");
  });

  it("won't let anyone take a block that would get no cleans, hides it from the board and tells the admin", async () => {
    const r = await as("superuser", async (q) => {
      // Ben's block A went back on the board long ago; block B at the same home starts tomorrow.
      await q.rows(`update public.series set starts_on = private.london_today() - 14 where id = $1`, [IDS.benSeries]);
      await q.rows(`insert into public.series (property_id, customer_id, cleaner_id, frequency, preferred_day, window_start, window_end,
                      duration_minutes, price_per_hour_pence, commission_type, commission_value, status, starts_on, claimed_at,
                      offering_since, block_size)
                    values ($1, $2, $3, 'weekly', extract(isodow from private.london_today() + 1)::smallint, '10:00', '14:00',
                      120, 2000, 'percent', 2500, 'claimed', private.london_today() + 1, now(), null, 1)`, [IDS.benProperty, U.ben, U.alex]);
      await q.actAs(U.tara);
      const board = await q.rows(`select * from public.job_board() where series_id = $1`, [IDS.benSeries]);
      const claim = await q.attempt(`select public.claim_series((select id from public.job_offers where series_id = $1 and cleaner_id = $2))`, [IDS.benSeries, U.tara]);
      await q.actAs(U.admin);
      const assign = await q.attempt(`select public.admin_assign_series($1, $2)`, [IDS.benSeries, U.tara]);
      await q.rows(`reset role`);
      await q.rows(`select * from private.release_offers()`);
      await q.rows(`select * from private.release_offers()`);
      return {
        board, claim, assign,
        alerts: await q.count(`public.engine_alerts where kind = 'block_closed' and series_id = '${IDS.benSeries}'`),
        status: (await q.rows<{ status: string }>(`select status from public.series where id = $1`, [IDS.benSeries]))[0]!.status,
      };
    });
    // Release closes it (final review): it would never be taken, so it mustn't sit on the board.
    expect(r).toEqual({ board: [], claim: "PC004", assign: "PC004", alerts: 1, status: "ended" });
  });

  it("f1: a block reopened with no cleans left closes on the next release, and the customer can book that home again", async () => {
    const r = await as("superuser", async (q) => {
      // Anna's block of 2: last week's clean done, today's still booked; Tara drops out today.
      await q.rows(`update public.series set block_size = 2 where id = $1`, [IDS.annaSeries]);
      await q.rows(`delete from public.visits where id = $1`, [IDS.visitNextWeek]);
      await q.rows(`select private.reopen_series($1)`, [IDS.annaSeries]);
      // Nobody covers it; today's clean is missed (no-show tomorrow morning).
      await q.rows(`update public.visits set status = 'no_show' where id = $1`, [IDS.visitToday]);
      await q.rows(`update public.series set offering_since = now() - interval '3 hours' where id = $1`, [IDS.annaSeries]);
      await q.rows(`select * from private.release_offers()`);
      const [s] = await q.rows(`select status, end_reason is not null as has_reason from public.series where id = $1`, [IDS.annaSeries]);
      const alerts = await q.rows<{ message: string }>(`select message from public.engine_alerts where kind = 'block_closed'`);
      const offers = await q.count(`public.job_offers where series_id = '${IDS.annaSeries}' and status = 'open'`);
      await q.actAs(U.anna);
      const rebook = await q.attempt(BOOK, booking({ property: IDS.annaProperty, frequency: "weekly", day: 1, from: "09:00", to: "12:00", minutes: 150, startsIn: 3 }));
      return { s, alerts, offers, rebook };
    });
    expect(r.s).toEqual({ status: "ended", has_reason: true });
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]!.message).toMatch(/no cleans left to give, so it has been closed\. 1 of its 2 cleans happened\./);
    expect(r.offers).toBe(0);
    expect(r.rebook).toBe("ok");
  });

  it("f4: the job board shows the block's real end if taken now, which is what claiming produces", async () => {
    const r = await as("superuser", async (q) => {
      // Ben's 4 fortnightly cleans were planned from next week; nobody took them for three weeks.
      const planned = (await q.rows<{ e: string }>(`select ends_on::text as e from public.series where id = $1`, [IDS.benSeries]))[0]!.e;
      await fakeToday(q, `(now() at time zone 'Europe/London')::date + 21`);
      await q.actAs(U.tara);
      const [board] = await q.rows<{ ends_on: string; block_size: number }>(`select ends_on::text, block_size from public.job_board() where series_id = $1`, [IDS.benSeries]);
      await q.rows(`select public.claim_series($1)`, [(await q.rows<{ offer_id: string }>(`select offer_id from public.job_board()`))[0]!.offer_id]);
      await q.rows(`reset role`);
      const after = (await q.rows<{ e: string; last: string }>(
        `select ends_on::text as e, (select max(scheduled_date)::text from public.visits where series_id = $1) as last from public.series where id = $1`, [IDS.benSeries]))[0]!;
      return { planned, board, after };
    });
    expect(r.board!.block_size).toBe(4);
    expect(r.board!.ends_on > r.planned).toBe(true); // slipped, not the stale planned date
    expect(r.board!.ends_on).toBe(r.after.e);
    expect(r.after.e).toBe(r.after.last);
  });

  it("note 3: when the block in the way goes, the shortfall alert closes and the cleans are booked again", async () => {
    const r = await as("superuser", async (q) => {
      await q.actAs(U.admin);
      await q.rows(`select public.admin_assign_series($1, $2)`, [IDS.benSeries, U.tara]);
      await q.rows(`select public.admin_reopen_series($1)`, [IDS.benSeries]);
      await q.rows(`reset role`);
      // Block B at Ben's home starts the day after A's 2nd clean would be: A loses its last two.
      const bId = (await q.rows<{ id: string }>(`insert into public.series (property_id, customer_id, cleaner_id, frequency, preferred_day, window_start, window_end,
                      duration_minutes, price_per_hour_pence, commission_type, commission_value, status, starts_on, claimed_at, offering_since, block_size)
                    select $1, $2, $3, 'weekly', extract(isodow from d)::smallint, '10:00', '14:00', 120, 2000, 'percent', 2500, 'claimed', d, now(), null, 1
                    from (select private.block_first_date(starts_on, preferred_day) + 15 as d from public.series where id = $4) x
                    returning id`, [IDS.benProperty, U.ben, U.alex, IDS.benSeries]))[0]!.id;
      await q.actAs(U.admin);
      await q.rows(`select public.admin_assign_series($1, $2)`, [IDS.benSeries, U.tara]);
      await q.rows(`reset role`);
      const cut = (await q.rows<{ c: number }>(`select cut_short_cleans as c from public.series where id = $1`, [IDS.benSeries]))[0]!.c;
      await q.rows(`update public.series set status = 'ended' where id = $1`, [bId]);
      await q.rows(`select private.generate_visits_for_series($1, null)`, [IDS.benSeries]);
      const after = (await q.rows(`select cut_short_cleans as c, (select count(*)::int from public.visits where series_id = $1) as n from public.series where id = $1`, [IDS.benSeries]))[0];
      const alert = (await q.rows(`select resolved_at is not null as resolved, message from public.engine_alerts where kind = 'block_overlap'`))[0];
      return { cut, after, alert };
    });
    expect(r.cut).toBe(2);
    expect(r.after).toEqual({ c: 0, n: 4 });
    expect(r.alert).toMatchObject({ resolved: true, message: expect.stringMatching(/No longer short/) });
  });

  it("note 4: a stalled block doesn't quietly restart when its cleaner comes back", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.cleaners set status = 'suspended' where id = $1`, [U.tara]);
      await fakeToday(q, `(select ends_on + 1 from public.series where id = '${IDS.annaSeries}')`);
      await q.rows(`select private.generate_visits()`);
      await q.rows(`update public.cleaners set status = 'active' where id = $1`, [U.tara]);
      await q.rows(`select private.generate_visits()`);
      return {
        visits: await q.count(`public.visits where series_id = '${IDS.annaSeries}'`),
        status: (await q.rows<{ status: string }>(`select status from public.series where id = $1`, [IDS.annaSeries]))[0]!.status,
        message: (await q.rows<{ message: string }>(`select message from public.engine_alerts where kind = 'block_stalled'`))[0]!.message,
      };
    });
    expect(r).toMatchObject({ visits: 3, status: "claimed" });
    expect(r.message).toMatch(/won't restart on its own.*end it in the admin console/);
  });
});

describe("final review: admin_end_block", () => {
  const END = `select public.admin_end_block($1, $2)`;

  it("is admin-only and needs a real reason", async () => {
    for (const who of ["anna", "tara", "alex", "sam", "anon"] as const) {
      expect({ who, code: await as(who, (q) => q.attempt(END, [IDS.annaSeries, "Customer moving house"])) }).toEqual({ who, code: DENIED });
    }
    for (const reason of [null, "", "   ", " ", "..", "x".repeat(301)]) {
      expect({ reason, code: await as("admin", (q) => q.attempt(END, [IDS.annaSeries, reason])) }).toEqual({ reason, code: "22023" });
    }
  });

  it("ends the block with the reason, removes cleans still to come, settles its alerts, audits it, and locks the address", async () => {
    const r = await setupThen(async (su) => {
      await su.rows(`insert into public.engine_alerts (kind, series_id, message) values ('block_stalled', $1, 'x')`, [IDS.annaSeries]);
    }, U.admin, async (q) => {
      await q.rows(END, [IDS.annaSeries, "Customer moving house"]);
      const [s] = await q.rows(`select status, end_reason from public.series where id = $1`, [IDS.annaSeries]);
      const visits = await q.rows<{ id: string }>(`select id from public.visits where series_id = $1 order by scheduled_date`, [IDS.annaSeries]);
      const [alert] = await q.rows(`select resolved_by from public.engine_alerts where series_id = $1`, [IDS.annaSeries]);
      const [audit] = await q.rows<{ actor_id: string; detail: { status: unknown } }>(
        `select actor_id, detail from public.audit_log where entity = 'series' and entity_id = $1 order by id desc limit 1`, [IDS.annaSeries]);
      const again = await q.attempt(END, [IDS.annaSeries, "Customer moving house"]);
      await q.actAs(U.tara);
      return { s, visits: visits.map((v) => v.id), alert, audit, again, taraSees: await q.count("public.properties") };
    });
    expect(r.s).toEqual({ status: "ended", end_reason: "Customer moving house" });
    expect(r.visits).toEqual([IDS.visitDone]); // today's and next week's booked cleans removed; history kept
    expect(r.alert).toEqual({ resolved_by: U.admin });
    expect(r.audit).toMatchObject({ actor_id: U.admin, detail: { status: { from: "claimed", to: "ended" } } });
    expect(r.again).toBe("PC005");
    expect(r.taraSees).toBe(0);
  });
});

describe("re-review: paused blocks and a failing sweep", () => {
  it("leaves a paused block's cleans alone overnight (pause isn't built yet)", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.series set status = 'paused' where id = $1`, [IDS.annaSeries]);
      await q.rows(`update public.visits set scheduled_date = private.london_today() - 1 where id = $1`, [IDS.visitToday]);
      await q.rows(`select private.generate_visits()`);
      return {
        visit: (await q.rows<{ status: string }>(`select status from public.visits where id = $1`, [IDS.visitToday]))[0]!.status,
        alerts: await q.count("public.engine_alerts"),
      };
    });
    expect(r).toEqual({ visit: "scheduled", alerts: 0 });
  });

  it("tells the admin when the missed-cleans check fails on the scheduler, and carries on", async () => {
    const c = await pool.connect();
    try {
      await c.query(`update public.visits set scheduled_date = (now() at time zone 'Europe/London')::date - 1 where id = $1`, [IDS.visitToday]);
      await c.query(`create function public.boom() returns trigger language plpgsql as $$ begin
        if new.status = 'no_show' then raise exception 'test failure'; end if; return new; end $$`);
      await c.query(`create trigger boom before update on public.visits for each row execute function public.boom()`);
      await c.query(`call private.run_generate_visits()`);
      await c.query(`reset search_path`);
      await c.query(`call private.run_generate_visits()`); // a second night: still one open alert, not two
      await c.query(`reset search_path`);
      const { rows } = await c.query(`select kind, series_id, message from public.engine_alerts where kind = 'generate_failed'`);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: "generate_failed", series_id: null });
      expect(rows[0].message).toMatch(/missed cleans/);
    } finally {
      await c.query(`reset search_path`);
      await c.query(`drop trigger if exists boom on public.visits`);
      await c.query(`drop function if exists public.boom()`);
      await c.query(`delete from public.engine_alerts`);
      await c.query(`update public.visits set scheduled_date = (now() at time zone 'Europe/London')::date, status = 'scheduled' where id = $1`, [IDS.visitToday]);
      await c.query(`delete from public.visits where series_id = $1 and id not in ($2, $3, $4)`, [IDS.annaSeries, IDS.visitDone, IDS.visitToday, IDS.visitNextWeek]);
      c.release();
    }
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
      `select private.close_stale_visits()`,
      `select private.hand_over_visits('${IDS.annaSeries}', '${U.alex}')`,
    ]) {
      for (const who of ["anna", "tara", "admin"] as const) {
        expect({ sql, who, code: await as(who, (q) => q.attempt(sql)) }).toEqual({ sql, who, code: DENIED });
      }
    }
  });
});
