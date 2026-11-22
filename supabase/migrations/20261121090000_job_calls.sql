-- Ping Clean: let the charge and payout jobs reach the app.
--
-- private.kick_charge_job() and private.kick_payout_job() call the app over HTTPS with
-- pg_net (net.http_post). Nothing switched pg_net on, and both functions answer
-- 'not_set_up' without it, so on a new Supabase project no card would ever be charged and
-- no cleaner paid, with nothing in the logs to say why.
--
-- Skipped where pg_net isn't installed (the local test database), like the pg_cron
-- schedules. No table, column, policy or grant changes here.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;
