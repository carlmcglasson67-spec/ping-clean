-- Ping Clean V1 — 8/8 Defence in depth.
-- Supabase grants every privilege on public tables to the API roles by default.
-- TRUNCATE ignores row level security, and REFERENCES / TRIGGER are never needed by
-- a browser, so take them away from anon and authenticated now and for any future table.
-- (PostgREST can't send TRUNCATE today; this closes it if a function ever could.)

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;

-- New functions: Postgres lets PUBLIC execute them, and Supabase also grants anon and
-- authenticated directly. Remove both, so every future function must grant its own
-- access on purpose (as every function so far already does). The PUBLIC default is
-- global, so it can't be scoped "in schema"; the anon/authenticated one can.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
