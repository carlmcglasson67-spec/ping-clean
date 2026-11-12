// A block isn't offered to cleaners until the customer has saved a card (security review
// finding 2, 12 Nov 2026), and a customer with an unpaid clean can't book another block.
import { afterAll, describe, expect, it } from "vitest";
import { as, IDS, pool, setupThen, U, type Query } from "./helpers";

afterAll(() => pool.end());

// Ben's block (seed): on offer, no card saved.
const offers = async (q: Query) => (await q.rows(`select 1 from public.job_offers where series_id = $1`, [IDS.benSeries])).length;
const release = async (q: Query) => (await q.rows<{ offers_created: number; now_unclaimed: boolean }>(`select * from private.release_one($1)`, [IDS.benSeries]))[0]!;
const fresh = (q: Query) => q.rows(`delete from public.job_offers where series_id = $1`, [IDS.benSeries]);
const saveCard = async (q: Query) => {
  await q.rows(`insert into private.customer_billing (customer_id, stripe_customer_id) values ($1, 'cus_TestBen00001')`, [U.ben]);
  await q.rows(`set local role service_role`);
  const r = await q.rows<{ r: string }>(`select public.stripe_card_saved($1, 'cus_TestBen00001', 'pm_TestBen00001', 'visa', '4242', 4::smallint, 2031::smallint) as r`, [IDS.benSeries]);
  await q.rows(`reset role`);
  return r[0]!.r;
};

describe("no card, no cleaners", () => {
  it("makes no offers, shows nothing on the job board and can't be claimed", async () => {
    const r = await as("superuser", async (q) => {
      const [offer] = await q.rows<{ id: string }>(`select id from public.job_offers where series_id = $1 and cleaner_id = $2`, [IDS.benSeries, U.tara]);
      await fresh(q);
      const released = await release(q);
      const made = await offers(q);
      // Even an offer that somehow exists (made before the rule) can't be seen or taken.
      await q.rows(`insert into public.job_offers (series_id, cleaner_id, tier, round, opens_at, status)
                    select id, $2, 'top', offer_round, now(), 'open' from public.series where id = $1`, [IDS.benSeries, U.tara]);
      const [mine] = await q.rows<{ id: string }>(`select id from public.job_offers where series_id = $1 and cleaner_id = $2`, [IDS.benSeries, U.tara]);
      await q.actAs(U.tara);
      const board = (await q.rows(`select offer_id from public.job_board()`)).length;
      const claim = await q.attempt(`select public.claim_series($1)`, [mine!.id]);
      return { seeded: Boolean(offer), released, made, board, claim };
    });
    expect(r).toEqual({ seeded: true, released: { offers_created: 0, now_unclaimed: false }, made: 0, board: 0, claim: "PC003" });
  });

  it("never tells the office it's unclaimed while it waits for a card, however long", async () => {
    const r = await as("superuser", async (q) => {
      await fresh(q);
      await q.rows(`update public.series set offering_since = now() - interval '30 days' where id = $1`, [IDS.benSeries]);
      const released = await release(q);
      const [s] = await q.rows<{ status: string }>(`select status::text from public.series where id = $1`, [IDS.benSeries]);
      return { released, status: s!.status };
    });
    expect(r).toEqual({ released: { offers_created: 0, now_unclaimed: false }, status: "offering" });
  });

  it("the office can't assign it either (PC007)", async () => {
    const r = await setupThen(async () => {}, U.admin, (q) => q.attempt(`select public.admin_assign_series($1, $2)`, [IDS.benSeries, U.tara]));
    expect(r).toBe("PC007");
  });
});

describe("the card arrives", () => {
  it("offers go out on the next release, with the tier windows starting from now, not from the booking", async () => {
    const r = await as("superuser", async (q) => {
      await fresh(q);
      await q.rows(`update public.series set offering_since = now() - interval '30 days' where id = $1`, [IDS.benSeries]);
      const saved = await saveCard(q);
      const [s] = await q.rows<{ fresh: boolean }>(`select offering_since > now() - interval '1 minute' as fresh from public.series where id = $1`, [IDS.benSeries]);
      const released = await release(q);
      const tiers = (await q.rows<{ tier: string }>(`select distinct tier::text from public.job_offers where series_id = $1 order by 1`, [IDS.benSeries])).map((t) => t.tier);
      await q.actAs(U.tara);
      const board = (await q.rows(`select offer_id from public.job_board()`)).length;
      return { saved, clockRestarted: s!.fresh, unclaimed: released.now_unclaimed, made: released.offers_created > 0, tiers, board };
    });
    // Only the Top tier at first: the customer's delay didn't use up the Top cleaners' head start.
    expect(r).toEqual({ saved: "saved", clockRestarted: true, unclaimed: false, made: true, tiers: ["top"], board: 1 });
  });

  it("a second card later doesn't restart the clock, and a first-refusal window still ahead is kept", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.series set offering_since = now() + interval '2 hours' where id = $1`, [IDS.benSeries]);
      await saveCard(q);
      const [first] = await q.rows<{ ahead: boolean }>(`select offering_since > now() + interval '1 hour' as ahead from public.series where id = $1`, [IDS.benSeries]);
      await q.rows(`update public.series set offering_since = now() - interval '3 hours' where id = $1`, [IDS.benSeries]);
      await q.rows(`set local role service_role`);
      await q.rows(`select public.stripe_card_saved($1, 'cus_TestBen00001', 'pm_TestBen00002', 'visa', '1881', 4::smallint, 2032::smallint)`, [IDS.benSeries]);
      await q.rows(`reset role`);
      const [second] = await q.rows<{ old: boolean }>(`select offering_since < now() - interval '2 hours' as old from public.series where id = $1`, [IDS.benSeries]);
      return { windowKept: first!.ahead, notRestarted: second!.old };
    });
    expect(r).toEqual({ windowKept: true, notRestarted: true });
  });

  it("a customer who already has a card is never held back", async () => {
    const r = await as("superuser", async (q) => {
      await fresh(q);
      await q.rows(`insert into private.customer_billing (customer_id, stripe_customer_id, default_payment_method_id) values ($1, 'cus_TestBen00001', 'pm_TestBen00001')`, [U.ben]);
      return (await release(q)).offers_created > 0;
    });
    expect(r).toBe(true);
  });
});

describe("an unpaid clean stops the next booking (PC029)", () => {
  // Two cleans, weekly, starting 60 days out (the date worked out before acting as the customer).
  const when = async (q: Query) => (await q.rows<{ d: string; dow: number }>(
    `select (private.london_today() + 60)::text as d, extract(isodow from private.london_today() + 60)::int as dow`))[0]!;
  const book = (q: Query, home: string, at: { d: string; dow: number }) => q.attempt(
    `select public.book_series($1, 'weekly', $3::smallint, '09:00', '13:00', 120, $2::date, 2::smallint, gen_random_uuid())`, [home, at.d, at.dow]);
  // A payment for next week's clean in the given state (the seed has none for it).
  const unpaid = async (q: Query, status: string) => {
    if (status === "none") return;
    await q.rows(`alter table public.payments disable trigger user`);
    await q.rows(`insert into public.payments (visit_id, customer_id, amount_pence, application_fee_pence, cleaner_amount_pence, kind, status, idempotency_key)
                  select id, customer_id, price_pence, ping_fee_pence, cleaner_earnings_pence, 'visit', $2::public.payment_status, 'payment:test:pc029'
                    from public.visits where id = $1`, [IDS.visitNextWeek, status]);
    await q.rows(`alter table public.payments enable trigger user`);
  };

  it("refuses while a payment has failed for good or is waiting on the customer; fine otherwise", async () => {
    const out: Record<string, string> = {};
    for (const status of ["failed_final", "requires_action", "failed", "succeeded", "none"]) {
      out[status] = await as("superuser", async (q) => {
        await unpaid(q, status);
        const at = await when(q);
        await q.actAs(U.anna);
        return book(q, IDS.annaProperty, at);
      });
    }
    expect(out.failed_final).toBe("PC029");
    expect(out.requires_action).toBe("PC029");
    // A try that failed but will be retried isn't a debt yet; and with nothing owed, booking
    // is only refused for its own reasons (never PC029).
    expect([out.failed, out.succeeded, out.none].includes("PC029")).toBe(false);
    expect(new Set([out.failed, out.succeeded, out.none]).size).toBe(1);
  });

  it("someone else's unpaid clean doesn't stop you", async () => {
    const r = await as("superuser", async (q) => {
      await unpaid(q, "failed_final"); // Anna's
      const at = await when(q);
      await q.actAs(U.ben);
      return book(q, IDS.benProperty, at);
    });
    expect(r).not.toBe("PC029");
  });
});
