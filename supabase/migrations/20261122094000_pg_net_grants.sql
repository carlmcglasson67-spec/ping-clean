-- Ping Clean: take pg_net away from the API roles (#60).
--
-- Supabase's pg_net set-up grants its schema and functions to anon and authenticated, and
-- its request queue (net.http_request_queue) briefly holds the charge and payout jobs'
-- secret header. That is out of reach today only because the `net` schema isn't exposed
-- through the API. Nothing in Ping needs those roles to use pg_net: only the scheduled jobs
-- call it, as the database owner, through security-definer functions. So the grants go.
--
-- Skipped where pg_net isn't installed (the local test database). If a pg_net upgrade puts
-- the grants back, running this file's body again removes them; the go-live list says how to
-- check (Database → Roles, or the query in intent/go-live/plan.md).

do $$
declare
  r text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    return;
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema net from %I', r);
      execute format('revoke all on all tables in schema net from %I', r);
      execute format('revoke all on all sequences in schema net from %I', r);
      execute format('revoke all on all functions in schema net from %I', r);
      execute format('alter default privileges in schema net revoke all on tables from %I', r);
      execute format('alter default privileges in schema net revoke all on functions from %I', r);
    end if;
  end loop;
end $$;
