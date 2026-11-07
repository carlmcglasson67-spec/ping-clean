// The SQL price split must match the shared fixture (and therefore lib/money exactly).
import { afterAll, describe, expect, it } from "vitest";
import fixture from "../fixtures/split-cases.json";
import { as, CHECK, IDS, pool, U } from "./helpers";

afterAll(() => pool.end());

describe("private.split_visit_price", () => {
  it.each(fixture.cases)("$pph p/h × $minutes min, $type $value → $price = $earnings + $fee", async (c) => {
    const [r] = await as("superuser", (q) =>
      q.rows(`select * from private.split_visit_price($1, $2, $3::public.commission_type, $4)`, [c.pph, c.minutes, c.type, c.value]),
    );
    expect(r).toEqual({ price_pence: c.price, ping_fee_pence: c.fee, cleaner_earnings_pence: c.earnings });
  });

  it("refuses to price with missing settings rather than guess", async () => {
    expect(await as("superuser", (q) => q.attempt(`select * from private.split_visit_price(null, 120, 'percent', 2500)`))).toBe("22004");
  });
});

describe("money constraints", () => {
  it("rejects a visit whose split doesn't add up", async () => {
    expect(await as("superuser", (q) => q.attempt(
      `update public.visits set price_pence = 5000, cleaner_earnings_pence = 3750, ping_fee_pence = 1000 where id = $1`, [IDS.visitToday]))).toBe(CHECK);
  });
  it("rejects a refund larger than the charge", async () => {
    expect(await as("superuser", (q) => q.attempt(
      `update public.payments set refunded_pence = 5001 where visit_id = $1`, [IDS.visitDone]))).toBe(CHECK);
  });
  it("allows only one live charge per visit", async () => {
    expect(await as("superuser", (q) => q.attempt(
      `insert into public.payments (visit_id, customer_id, amount_pence, application_fee_pence, idempotency_key) values ($1, $2, 5000, 1250, 'dupe')`,
      [IDS.visitDone, U.anna]))).toBe("23505");
  });
  it("allows only one live payout per visit", async () => {
    expect(await as("superuser", (q) => q.attempt(
      `insert into public.payouts (visit_id, cleaner_id, amount_pence, available_after, idempotency_key) values ($1, $2, 3750, now(), 'dupe')`,
      [IDS.visitDone, U.tara]))).toBe("23505");
  });
  it("stores money as integers only", async () => {
    const rows = await as("superuser", (q) => q.rows<{ col: string; data_type: string }>(
      `select table_name || '.' || column_name as col, data_type from information_schema.columns
       where table_schema = 'public' and column_name like '%pence%'`));
    expect(rows.length).toBeGreaterThan(8);
    expect(rows.filter((r) => r.data_type !== "integer")).toEqual([]);
  });
});
