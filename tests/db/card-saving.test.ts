// Payments PR 4: saving a card at booking. The server-only functions and the customer's
// "Card saved" check, per role.
import { afterAll, describe, expect, it } from "vitest";
import { as, DENIED, IDS, pool, setupThen, U, type Query } from "./helpers";

afterAll(() => pool.end());

const server = <T>(fn: (q: Query) => Promise<T>, setup?: (su: Query) => Promise<void>) => as("superuser", async (q) => {
  if (setup) await setup(q);
  await q.rows(`set local role service_role`);
  const out = await fn(q);
  await q.rows(`reset role`);
  return out;
});
const one = async <T>(q: Query, sql: string, args: unknown[] = []) => (await q.rows<{ r: T }>(sql, args))[0]!.r;
const LINK = `select public.stripe_link_customer($1, $2) as r`;
const SAVE = `select public.stripe_card_saved($1, $2, $3, 'visa', '4242', 12::smallint, 2030::smallint) as r`;

describe("one Stripe customer per Ping customer", () => {
  it("keeps the first id if two checkouts race, and reads it back", async () => {
    const r = await server(async (q) => ({
      first: await one<string>(q, LINK, [U.anna, "cus_TestAnna01"]),
      second: await one<string>(q, LINK, [U.anna, "cus_TestAnna02"]),
      read: await one<string>(q, `select public.stripe_customer_for($1) as r`, [U.anna]),
      nobody: await one<string | null>(q, `select public.stripe_customer_for($1) as r`, [U.ben]),
    }));
    expect(r).toEqual({ first: "cus_TestAnna01", second: "cus_TestAnna01", read: "cus_TestAnna01", nobody: null });
  });

  it("is only for customers", async () => {
    expect(await server((q) => q.attempt(LINK, [U.tara, "cus_TestTara01"]))).toBe(DENIED);
  });
});

describe("stripe_card_saved (from the webhook)", () => {
  const linked = async (su: Query) => { await su.rows(LINK, [U.anna, "cus_TestAnna01"]); };

  it("saves the card for the block and as the customer's card, when the Stripe customer is theirs", async () => {
    const r = await server(async (q) => {
      const res = await one<string>(q, SAVE, [IDS.annaSeries, "cus_TestAnna01", "pm_TestAnnaCard1"]);
      await q.rows(`reset role`);
      const [b] = await q.rows(`select stripe_payment_method_id from public.series_billing where series_id = $1`, [IDS.annaSeries]);
      const [c] = await q.rows(`select default_payment_method_id, card_brand, card_last4 from private.customer_billing where customer_id = $1`, [U.anna]);
      await q.rows(`set local role service_role`);
      return { res, b, c };
    }, linked);
    expect(r).toEqual({ res: "saved", b: { stripe_payment_method_id: "pm_TestAnnaCard1" },
      c: { default_payment_method_id: "pm_TestAnnaCard1", card_brand: "visa", card_last4: "4242" } });
  });

  it("stores nothing for someone else's Stripe customer, a customer with no link, or an ended block", async () => {
    const r = await server(async (q) => ({
      someoneElse: await one<string>(q, SAVE, [IDS.annaSeries, "cus_TestMallory1", "pm_TestMallory1"]),
      bensBlock: await one<string>(q, SAVE, [IDS.benSeries, "cus_TestAnna01", "pm_TestAnnaCard1"]),
      unknown: await one<string>(q, SAVE, ["00000000-0000-4000-c000-0000000000ff", "cus_TestAnna01", "pm_TestAnnaCard1"]),
    }), linked);
    expect(r).toMatchObject({ someoneElse: "mismatch", bensBlock: "mismatch", unknown: "no_series" });
    const ended = await server((q) => one<string>(q, SAVE, [IDS.annaSeries, "cus_TestAnna01", "pm_TestAnnaCard1"]), async (su) => {
      await linked(su);
      await su.rows(`update public.series set status = 'ended' where id = $1`, [IDS.annaSeries]);
    });
    expect(ended).toBe("no_series");
  });

  it("logs the change as the Stripe webhook, without the card's ids", async () => {
    const rows = await server(async (q) => {
      await q.rows(SAVE, [IDS.annaSeries, "cus_TestAnna01", "pm_TestAnnaCard1"]);
      await q.rows(`reset role`);
      return q.rows<{ actor_label: string; entity: string; detail: object }>(
        `select actor_label, entity, detail from public.audit_log where entity in ('series_billing', 'customer_billing') order by id`);
    }, linked);
    expect(rows.map((r) => [r.entity, r.actor_label])).toEqual([["customer_billing", "stripe"], ["series_billing", "stripe-webhook"], ["customer_billing", "stripe-webhook"]]);
    expect(JSON.stringify(rows)).not.toMatch(/pm_TestAnna|cus_TestAnna|4242/);
  });
});

describe("who can call what", () => {
  it("lets only the server link customers and save cards", async () => {
    for (const who of ["anon", "anna", "tara", "admin"] as const) {
      const r = await as(who, async (q) => ({
        link: await q.attempt(LINK, [U.anna, "cus_TestAnna01"]),
        read: await q.attempt(`select public.stripe_customer_for($1)`, [U.anna]),
        save: await q.attempt(SAVE, [IDS.annaSeries, "cus_TestAnna01", "pm_TestAnnaCard1"]),
      }));
      expect({ who, ...r }).toEqual({ who, link: DENIED, read: DENIED, save: DENIED });
    }
  });

  it("tells a customer whether their own block has a card, and nobody else", async () => {
    const setup = async (su: Query) => {
      await su.rows(LINK, [U.anna, "cus_TestAnna01"]);
      await su.rows(SAVE, [IDS.annaSeries, "cus_TestAnna01", "pm_TestAnnaCard1"]);
    };
    const check = `select public.series_card_saved($1) as r`;
    expect(await setupThen(setup, U.anna, (q) => one<boolean>(q, check, [IDS.annaSeries]))).toBe(true);
    expect(await setupThen(setup, U.anna, (q) => one<boolean>(q, check, [IDS.benSeries]))).toBe(false);
    for (const who of ["ben", "tara"] as const) {
      expect({ who, r: await setupThen(setup, U[who], (q) => one<boolean>(q, check, [IDS.annaSeries])) }).toEqual({ who, r: false });
    }
    expect(await as("anon", (q) => q.attempt(check, [IDS.annaSeries]))).toBe(DENIED);
  });
});
