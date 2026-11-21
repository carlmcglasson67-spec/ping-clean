// The live database starts with the migrations and nothing else: no seed, no test logins.
// This walks brand-new people through one whole clean on a database built exactly that way
// (scripts/db-test.sh makes it: ping_bare), so anything the product needs that only ever
// lived in the seed fails here instead of on launch day. It did once: the cleaner's
// checklist existed only in the seed, and no clean could have been started.
//
// ping-money-rules: "write a test that books, completes, charges and pays out one visit,
// and show the three amounts it produced". This is that test from an empty database, as far
// as the cleaner's share waiting out its check period. It does not cover the bank payout
// itself, rebooking, cancelling, refunds, failed payments or the nightly jobs: those have
// their own files, on the seeded database.
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";

const url = process.env.PING_BARE_DATABASE_URL;
if (!url) throw new Error("PING_BARE_DATABASE_URL not set. Run tests through `npm run test:db`.");
const pool = new pg.Pool({ connectionString: url, max: 2 });
afterAll(() => pool.end());

const ADMIN = "10000000-0000-4000-a000-000000000001";
const CUSTOMER = "10000000-0000-4000-a000-000000000002";
const CLEANER = "10000000-0000-4000-a000-000000000003";

type Db = {
  rows: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>;
  one: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R>;
  /** Act as a signed-in person, the way the API does. */
  actAs: (id: string) => Promise<void>;
  /** Act as the app's server (the service role). */
  server: () => Promise<void>;
  /** Back to the database owner: what a migration, cron job or the SQL editor runs as. */
  owner: () => Promise<void>;
};

/** One transaction on the empty database, always rolled back. */
async function onEmptyDatabase<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const rows: Db["rows"] = async (sql, params) => (await client.query(sql, params)).rows;
  const db: Db = {
    rows,
    one: async (sql, params) => {
      const r = await rows(sql, params);
      if (r.length !== 1) throw new Error(`expected one row, got ${r.length}: ${sql}`);
      return r[0] as never;
    },
    actAs: async (id) => {
      await rows(`reset role`);
      await rows(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id, role: "authenticated" })]);
      await rows(`set local role authenticated`);
    },
    server: async () => {
      await rows(`reset role`);
      await rows(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: "service_role" })]);
      await rows(`set local role service_role`);
    },
    owner: async () => {
      await rows(`reset role`);
      await rows(`select set_config('request.jwt.claims', '', true)`);
    },
  };
  try {
    await client.query("begin");
    return await fn(db);
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
}

/** A sign-up, as Supabase Auth records it. The database turns it into a profile. */
const signUp = (db: Db, id: string, email: string, name: string) =>
  db.rows(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                             raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                             confirmation_token, recovery_token, email_change_token_new, email_change)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, 'x', now(),
             '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', $3::text), now(), now(), '', '', '', '')`,
    [id, email, name],
  );

describe("a database with the migrations and no seed", () => {
  it("starts closed, with the things only a migration can provide", async () => {
    const r = await onEmptyDatabase(async (db) => ({
      people: (await db.one<{ n: number }>(`select count(*)::int as n from public.profiles`)).n,
      ready: (await db.one<{ r: boolean }>(`select private.settings_ready() as r`)).r,
      // The cleaner's checklist: without a default template nobody can start a clean (PC015).
      checklist: (await db.one<{ n: number }>(`select jsonb_array_length(items)::int as n from public.checklist_templates where is_default`)).n,
      buckets: (await db.rows<{ id: string; public: boolean }>(`select id, public from storage.buckets order by id`)),
    }));
    expect(r).toEqual({
      people: 0, ready: false, checklist: 11,
      buckets: [{ id: "cleaner-documents", public: false }, { id: "visit-photos", public: false }],
    });
  });

  it("takes new people from sign-up to a paid clean, with the money adding up", async () => {
    const r = await onEmptyDatabase(async (db) => {
      const when = await db.one<{ start: string; dow: number; cover: string }>(
        `select (private.london_today() + 3)::text as start, extract(isodow from private.london_today() + 3)::int as dow,
                (private.london_today() + 300)::text as cover`);

      // 1. Three people sign up. Everyone starts as a customer; nobody picks their own role.
      await signUp(db, ADMIN, "office@example.test", "Office Person");
      await signUp(db, CUSTOMER, "customer@example.test", "Casey Customer");
      await signUp(db, CLEANER, "cleaner@example.test", "Clare Cleaner");
      const roles = await db.rows<{ role: string }>(`select role::text from public.profiles order by id`);

      // 2. The first admin is made by the project owner (intent/go-live/plan.md). There is no
      //    other way in, by design.
      await db.rows(`update public.profiles set role = 'admin' where id = $1`, [ADMIN]);

      // 3. The admin opens booking from the settings screen: Carl's price, one district.
      await db.actAs(ADMIN);
      await db.rows(
        `update public.settings set price_per_hour_pence = 2500, min_booking_minutes = 120,
                commission_type = 'percent', commission_value = 2000,
                top_window_minutes = 60, approved_window_minutes = 120, unclaimed_alert_minutes = 720,
                launch_districts = '{CA14}'`);
      await db.owner();
      const open = (await db.one<{ ready: boolean; price: number }>(
        `select ready, price_per_hour_pence as price from public.public_pricing()`));

      // 4. The cleaner applies, uploads the four documents, and the admin approves them.
      await db.actAs(CLEANER);
      await db.rows(`select public.apply_as_cleaner()`);
      await db.rows(`update public.cleaners set areas = '{CA14}',
                       availability = (select jsonb_agg(jsonb_build_object('day', d, 'from', '08:00', 'to', '18:00')) from generate_series(1, 7) d)
                     where id = $1`, [CLEANER]);
      for (const kind of ["insurance", "dbs", "photo_id", "right_to_work"]) {
        await db.rows(
          `insert into public.cleaner_documents (cleaner_id, kind, storage_path, expires_on)
           values ($1::uuid, $2::public.document_kind, $1::text || '/' || $2 || '.pdf',
                   case when $2 = 'insurance' then $3::date end)`, [CLEANER, kind, when.cover]);
      }
      await db.actAs(ADMIN);
      await db.rows(`update public.cleaner_documents set status = 'verified', reviewed_by = $1, reviewed_at = now() where cleaner_id = $2`, [ADMIN, CLEANER]);
      await db.rows(`select public.admin_review_cleaner($1, 'approve', 'approved', null)`, [CLEANER]);

      // 5. The cleaner sets up how they get paid (Stripe's webhook reports the account ready).
      await db.server();
      await db.rows(`select public.stripe_link_cleaner_account($1, 'acct_TestFromEmpty1')`, [CLEANER]);
      await db.rows(`select public.stripe_account_status('acct_TestFromEmpty1', true, true, true, false)`);

      // 6. The customer adds a home and books a block of four weekly two-hour cleans.
      await db.actAs(CUSTOMER);
      const home = (await db.one<{ id: string }>(
        `insert into public.properties (customer_id, address_line1, town, postcode, bedrooms, bathrooms)
         values ($1, '1 New Road', 'Workington', 'CA14 1AA', 2, 1) returning id`, [CUSTOMER])).id;
      const series = (await db.one<{ id: string }>(
        `select public.book_series($1, 'weekly', $2::smallint, '09:00', '13:00', 120, $3::date, 4::smallint, gen_random_uuid()) as id`,
        [home, when.dow, when.start])).id;

      // 7. No card yet, so cleaners aren't offered it. Then the card is saved (Stripe's webhook).
      await db.owner();
      await db.rows(`select * from private.release_offers()`);
      const beforeCard = (await db.one<{ n: number }>(`select count(*)::int as n from public.job_offers where series_id = $1`, [series])).n;
      await db.server();
      await db.rows(`select public.stripe_link_customer($1, 'cus_TestFromEmpty1')`, [CUSTOMER]);
      await db.rows(`select public.stripe_card_saved($1, 'cus_TestFromEmpty1', 'pm_TestFromEmpty1', 'visa', '4242', 12::smallint, 2030::smallint)`, [series]);
      await db.owner();
      await db.rows(`select * from private.release_offers()`);
      // The "top" window passes with no top-tier cleaner about; the next tick opens it wider.
      await db.rows(`update public.series set offering_since = offering_since - interval '2 hours' where id = $1`, [series]);
      await db.rows(`update public.job_offers set opens_at = opens_at - interval '2 hours' where series_id = $1`, [series]);
      await db.rows(`select * from private.release_offers()`);

      // 8. The cleaner sees it on the board, with what they'll earn, and takes it on.
      await db.actAs(CLEANER);
      const board = await db.rows<{ offer_id: string; earnings_per_visit_pence: number; town: string }>(
        `select offer_id, earnings_per_visit_pence, town from public.job_board()`);
      await db.rows(`select public.claim_series($1)`, [board[0]?.offer_id]);
      await db.owner();
      const visits = await db.rows<{ id: string }>(`select id from public.visits where series_id = $1 order by scheduled_date`, [series]);
      const visit = visits[0]!.id;

      // 9. The day of the first clean. (Booking can't start today, so move the clean here.)
      await db.rows(`update public.visits set scheduled_date = private.london_today() where id = $1`, [visit]);
      await db.actAs(CLEANER);
      await db.rows(`select public.start_visit($1)`, [visit]);
      const ticks = (await db.one<{ n: number }>(`select count(*)::int as n from public.checklist_items where visit_id = $1`, [visit])).n;
      await db.rows(`update public.checklist_items set done = true where visit_id = $1`, [visit]);
      for (const kind of ["before", "after"]) {
        await db.rows(`insert into storage.objects (bucket_id, name, owner, metadata) values ('visit-photos', $1, auth.uid(), '{"size": 184000}')`, [`${visit}/${kind}.jpg`]);
        await db.rows(`insert into public.visit_photos (visit_id, kind, storage_path, uploaded_by) values ($1, $2::public.photo_kind, $3, $4)`, [visit, kind, `${visit}/${kind}.jpg`, CLEANER]);
      }
      await db.rows(`select public.complete_visit($1)`, [visit]);

      // 10. The money: one charge for the clean's own three amounts; Stripe says it was paid;
      //     the cleaner's share waits out the check period before it can be paid out.
      await db.owner();
      const clean = await db.one<{ price_pence: number; cleaner_earnings_pence: number; ping_fee_pence: number }>(
        `select price_pence, cleaner_earnings_pence, ping_fee_pence from public.visits where id = $1`, [visit]);
      await db.server();
      const [job] = await db.rows<{ payment_id: string; amount_pence: number; application_fee_pence: number; cleaner_account_id: string; stripe_customer_id: string; payment_method_id: string }>(
        `select * from public.charge_claim(10)`);
      const paid = (await db.one<{ r: string }>(
        `select public.stripe_payment_result($1, 'pi_TestFromEmpty1', 'succeeded', $2, $3, $4, 'ch_TestFromEmpty1', null, null) as r`,
        [job?.payment_id, job?.amount_pence, job?.application_fee_pence, job?.cleaner_account_id])).r;
      await db.owner();
      const payment = await db.one<{ status: string; amount_pence: number; application_fee_pence: number; cleaner_amount_pence: number }>(
        `select status::text, amount_pence, application_fee_pence, cleaner_amount_pence from public.payments where visit_id = $1`, [visit]);
      const payout = await db.one<{ status: string; amount_pence: number; wait_hours: number }>(
        `select status::text, amount_pence, round(extract(epoch from available_after - now()) / 3600)::int as wait_hours
           from public.payouts where visit_id = $1`, [visit]);

      return { roles, open, beforeCard, board: board.map((b) => ({ town: b.town, earns: b.earnings_per_visit_pence })), cleans: visits.length, ticks,
               clean, job: { customer: job?.stripe_customer_id, card: job?.payment_method_id, to: job?.cleaner_account_id }, paid, payment, payout };
    });

    expect(r.roles).toEqual([{ role: "customer" }, { role: "customer" }, { role: "customer" }]);
    expect(r.open).toEqual({ ready: true, price: 2500 });
    expect(r.beforeCard).toBe(0);
    // £50 for two hours at Carl's price; the cleaner sees their £40 before saying yes.
    expect(r.board).toEqual([{ town: "Workington", earns: 4000 }]);
    expect(r.cleans).toBe(4);
    expect(r.ticks).toBe(11);
    expect(r.clean).toEqual({ price_pence: 5000, cleaner_earnings_pence: 4000, ping_fee_pence: 1000 });
    expect(r.job).toEqual({ customer: "cus_TestFromEmpty1", card: "pm_TestFromEmpty1", to: "acct_TestFromEmpty1" });
    expect(r.paid).toBe("succeeded");
    expect(r.payment).toEqual({ status: "succeeded", amount_pence: 5000, application_fee_pence: 1000, cleaner_amount_pence: 4000 });
    expect(r.payout).toEqual({ status: "pending", amount_pence: 4000, wait_hours: 72 });
  });
});
