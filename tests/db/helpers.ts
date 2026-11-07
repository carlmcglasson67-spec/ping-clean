import pg from "pg";

// Seeded test logins (see supabase/seed.sql).
export const U = {
  admin: "00000000-0000-4000-a000-000000000001",
  anna: "00000000-0000-4000-a000-000000000002", // customer, claimed weekly series
  ben: "00000000-0000-4000-a000-000000000003", // customer, series still on offer
  tara: "00000000-0000-4000-a000-000000000004", // cleaner, active, top
  alex: "00000000-0000-4000-a000-000000000005", // cleaner, active, approved
  sam: "00000000-0000-4000-a000-000000000006", // cleaner applicant
} as const;

export const IDS = {
  annaProperty: "00000000-0000-4000-b000-000000000001",
  benProperty: "00000000-0000-4000-b000-000000000002",
  annaSeries: "00000000-0000-4000-c000-000000000001",
  benSeries: "00000000-0000-4000-c000-000000000002",
  visitDone: "00000000-0000-4000-e000-000000000001",
  visitToday: "00000000-0000-4000-e000-000000000002",
  visitNextWeek: "00000000-0000-4000-e000-000000000003",
  annaRequest: "00000000-0000-4000-9000-000000000001",
} as const;

const url = process.env.PING_TEST_DATABASE_URL;
if (!url) throw new Error("PING_TEST_DATABASE_URL not set. Run tests through `npm run test:db`.");

export const pool = new pg.Pool({ connectionString: url, max: 4 });

type Who = keyof typeof U | "anon" | "superuser" | { id: string };

/**
 * Runs `fn` inside a transaction as the given user, the way Supabase's API does:
 * SET ROLE authenticated (or anon) with the JWT claims in request.jwt.claims.
 * Always rolls back, so every test starts from the seed.
 */
export async function as<T>(who: Who, fn: (q: Query) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (who !== "superuser") {
      const sub = who === "anon" ? null : typeof who === "string" ? U[who] : who.id;
      const role = sub ? "authenticated" : "anon";
      const claims = JSON.stringify(sub ? { sub, role } : { role });
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
      await client.query(`set local role ${role}`);
    }
    return await fn(makeQuery(client));
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
}

export type Query = {
  rows: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>;
  count: (table: string) => Promise<number>;
  /** Resolves to the Postgres error code, or "ok" if the statement succeeded. Uses a savepoint. */
  attempt: (sql: string, params?: unknown[]) => Promise<string>;
  /** Like attempt, but also returns the error's detail (e.g. how many checklist items are left). */
  failure: (sql: string, params?: unknown[]) => Promise<{ code: string; detail?: string } | null>;
  /** Switch this transaction to acting as a signed-in user (after superuser setup). */
  actAs: (id: string) => Promise<void>;
};

function makeQuery(client: pg.PoolClient): Query {
  let sp = 0;
  return {
    rows: async (sql, params) => (await client.query(sql, params)).rows,
    count: async (table) => Number((await client.query(`select count(*)::int as n from ${table}`)).rows[0].n),
    attempt: async (sql, params) => {
      const name = `sp_${++sp}`;
      await client.query(`savepoint ${name}`);
      try {
        const r = await client.query(sql, params);
        await client.query(`release savepoint ${name}`);
        return r.rowCount === 0 && /^\s*(update|delete)/i.test(sql) ? "no-rows" : "ok";
      } catch (e) {
        await client.query(`rollback to savepoint ${name}`);
        return (e as { code?: string }).code ?? "error";
      }
    },
    failure: async (sql, params) => {
      const name = `sp_${++sp}`;
      await client.query(`savepoint ${name}`);
      try {
        await client.query(sql, params);
        await client.query(`release savepoint ${name}`);
        return null;
      } catch (e) {
        await client.query(`rollback to savepoint ${name}`);
        const err = e as { code?: string; detail?: string };
        return { code: err.code ?? "error", detail: err.detail };
      }
    },
    actAs: async (id) => {
      await client.query(`reset role`);
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id, role: "authenticated" })]);
      await client.query(`set local role authenticated`);
    },
  };
}

/** Superuser setup, then act as `who` (a user id) in the same rolled-back transaction. */
export async function setupThen<T>(setup: (su: Query) => Promise<void>, who: string | null, fn: (q: Query) => Promise<T>): Promise<T> {
  return as("superuser", async (su) => {
    await setup(su);
    if (who) await su.actAs(who);
    return fn(su);
  });
}

// Postgres error codes the tests expect.
export const DENIED = "42501"; // insufficient_privilege, also RLS "new row violates policy"
export const CHECK = "23514"; // check_violation
