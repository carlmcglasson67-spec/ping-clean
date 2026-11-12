-- Ping Clean: payments PR 5, cleaners' payments set-up (Stripe Connect Express; payments plan
-- signed off by Carl on 8 Nov 2026, C10). Stripe TEST mode only. No money moves here.
--
-- No new tables or columns: the cleaners' Stripe columns arrived with the money schema.
--
--   stripe_cleaner_account_for(cleaner)        server: the cleaner's Stripe account id, if any
--   stripe_link_cleaner_account(cleaner, acct) server: remember it (one per cleaner, first wins)
--   stripe_account_status(acct, …)             server (webhook): what Stripe says the account
--                                              can do now
--
-- And the rule itself (C10): a cleaner whose Stripe account can't take payments and payouts
-- yet isn't offered blocks, doesn't see them on the job board, can't claim them and can't be
-- assigned them. Otherwise a clean could be done with nowhere for the money to go.

create function public.stripe_cleaner_account_for(p_cleaner uuid) returns text
language sql stable security definer set search_path = '' as $$
  select stripe_account_id from public.cleaners where id = p_cleaner
$$;

-- First one wins, so two taps at once can't leave a cleaner with two Stripe accounts in Ping.
-- Only cleaners the Ping team has approved get one. Returns the id Ping keeps.
create function public.stripe_link_cleaner_account(p_cleaner uuid, p_account text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  kept text;
begin
  if not exists (select 1 from public.cleaners c join public.profiles p on p.id = c.id
                 where c.id = p_cleaner and c.status = 'active' and p.role = 'cleaner') then
    raise exception 'Only approved cleaners set up payments' using errcode = '42501';
  end if;
  perform set_config('app.actor', 'stripe', true);
  update public.cleaners set stripe_account_id = p_account
   where id = p_cleaner and stripe_account_id is null;
  select stripe_account_id into kept from public.cleaners where id = p_cleaner;
  return kept;
end $$;

-- From the account.updated webhook (and when a cleaner comes back from Stripe's form). The
-- values are read from Stripe itself by the server, never from a browser.
--   'updated' · 'unknown_account' (not an account Ping linked to a cleaner: nothing stored)
create function public.stripe_account_status(
  p_account text, p_charges_enabled boolean, p_payouts_enabled boolean,
  p_details_submitted boolean, p_requirements_due boolean
) returns text
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform set_config('app.actor', 'stripe-webhook', true);
  update public.cleaners
     set stripe_charges_enabled = coalesce(p_charges_enabled, false),
         stripe_payouts_enabled = coalesce(p_payouts_enabled, false),
         stripe_details_submitted = coalesce(p_details_submitted, false),
         stripe_requirements_due = coalesce(p_requirements_due, false),
         stripe_status_at = now()
   where stripe_account_id = p_account;
  if not found then
    return 'unknown_account';
  end if;
  return 'updated';
end $$;

revoke all on function public.stripe_cleaner_account_for(uuid), public.stripe_link_cleaner_account(uuid, text),
  public.stripe_account_status(text, boolean, boolean, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.stripe_cleaner_account_for(uuid), public.stripe_link_cleaner_account(uuid, text),
  public.stripe_account_status(text, boolean, boolean, boolean, boolean) to service_role;

-- ---------------------------------------------------------------- C10: payable before work
-- eligible_cleaners is what offers, the job board and claim_series all go by, so the rule
-- lives here once. As before, plus private.cleaner_payable on both branches.
create or replace function private.eligible_cleaners(p_series uuid)
returns table (cleaner_id uuid, tier public.cleaner_tier, first_refusal boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.tier, false
  from public.series s
  join public.properties pr on pr.id = s.property_id
  join public.cleaners c on pr.postcode_district = any (c.areas)
  where s.id = p_series
    and c.tier = any (private.open_tiers(p_series))
    and private.cleaner_fits(c.id, pr.postcode_district, s.preferred_day)
    and private.cleaner_payable(c.id)
  union all
  select c.id, c.tier, true
  from public.series s
  join public.properties pr on pr.id = s.property_id
  join public.cleaners c on c.id = s.first_refusal_cleaner_id
  where s.id = p_series
    and s.status = 'offering'
    and now() < s.offering_since
    and private.cleaner_fits(c.id, pr.postcode_district, s.preferred_day)
    and private.cleaner_payable(c.id)
$$;

-- The admin can't hand a block to a cleaner who can't be paid for it either (PC006).
create or replace function public.admin_assign_series(p_series uuid, p_cleaner uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.series;
  c public.cleaners;
begin
  if not private.is_admin() then
    raise exception 'Only the Ping team can assign jobs' using errcode = '42501';
  end if;
  select * into s from public.series where id = p_series for update;
  if not found or s.status not in ('offering', 'unclaimed') then
    raise exception 'That job has already been taken' using errcode = 'PC002';
  end if;
  select c2.* into c from public.cleaners c2 join public.profiles p on p.id = c2.id
  where c2.id = p_cleaner and c2.status = 'active' and p.role = 'cleaner'
  for share of c2;
  if not found then
    raise exception 'That cleaner isn''t active' using errcode = 'PC001';
  end if;
  if not private.cleaner_payable(p_cleaner) then
    raise exception 'That cleaner hasn''t finished setting up payments' using errcode = 'PC006';
  end if;
  if private.block_capacity(s.id) = 0 then
    raise exception 'That job can''t go ahead on its dates any more' using errcode = 'PC004';
  end if;

  update public.series set cleaner_id = p_cleaner, status = 'claimed', claimed_at = now(), offering_since = null
  where id = s.id;
  insert into public.job_offers (series_id, cleaner_id, tier, round, opens_at, status, responded_at)
  values (s.id, p_cleaner, c.tier, s.offer_round, now(), 'claimed', now())
  on conflict on constraint job_offers_one_per_round
    do update set status = 'claimed', responded_at = now();
  update public.job_offers set status = 'withdrawn', responded_at = now()
  where job_offers.series_id = s.id and job_offers.round = s.offer_round and cleaner_id <> p_cleaner
    and job_offers.status in ('open', 'pending');

  perform private.hand_over_visits(s.id, p_cleaner);
  perform private.generate_visits_for_series(s.id, null);  -- the whole block, now
end $$;
