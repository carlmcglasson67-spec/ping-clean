-- Ping Clean V1 — 8/8 Defence in depth.
-- Supabase grants every privilege on public tables to the API roles by default.
-- TRUNCATE ignores row level security, and REFERENCES / TRIGGER are never needed by
-- a browser, so take them away from anon and authenticated now and for any future table.
-- (PostgREST can't send TRUNCATE today; this closes it if a function ever could.)

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;

-- Functions are executable by PUBLIC by default in Postgres. Every public function
-- we've written grants its own access explicitly; make that the rule for new ones.
alter default privileges in schema public revoke execute on functions from public;
