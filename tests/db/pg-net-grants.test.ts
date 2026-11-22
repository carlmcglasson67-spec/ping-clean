// pg_net is taken away from the API roles (20261122094000_pg_net_grants.sql, #60). The test
// database has no pg_net, so a stand-in `net` schema is made with the grants Supabase's set-up
// gives, then the migration's body is run against it.
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { as, pool } from "./helpers";

afterAll(() => pool.end());

const MIGRATION = readFileSync("supabase/migrations/20261122094000_pg_net_grants.sql", "utf8");

describe("pg_net grants", () => {
  it("leaves anon and authenticated with nothing in the net schema", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`create schema net`);
      await q.rows(`create table net.http_request_queue (id bigserial primary key, headers jsonb)`);
      await q.rows(`create function net.http_post(url text) returns bigint language sql as 'select 1::bigint'`);
      await q.rows(`grant usage on schema net to anon, authenticated`);
      await q.rows(`grant all on all tables in schema net to anon, authenticated`);
      await q.rows(`grant all on all sequences in schema net to anon, authenticated`);
      await q.rows(`grant execute on all functions in schema net to anon, authenticated`);
      const before = await q.rows<{ ok: boolean }>(`select has_schema_privilege('anon', 'net', 'usage') as ok`);
      await q.rows(MIGRATION);
      const after = await q.rows<Record<string, boolean>>(`select
        has_schema_privilege('anon', 'net', 'usage') as anon_schema,
        has_schema_privilege('authenticated', 'net', 'usage') as auth_schema,
        has_table_privilege('anon', 'net.http_request_queue', 'select') as anon_queue,
        has_table_privilege('authenticated', 'net.http_request_queue', 'select') as auth_queue,
        has_function_privilege('anon', 'net.http_post(text)', 'execute') as anon_post,
        has_function_privilege('authenticated', 'net.http_post(text)', 'execute') as auth_post`);
      return { before: before[0]!.ok, after: after[0] };
    });
    expect(r.before).toBe(true);
    expect(r.after).toEqual({ anon_schema: false, auth_schema: false, anon_queue: false, auth_queue: false, anon_post: false, auth_post: false });
  });

  it("does nothing where pg_net isn't installed", async () => {
    expect(await as("superuser", (q) => q.attempt(MIGRATION))).toBe("ok");
  });
});
