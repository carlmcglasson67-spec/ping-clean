-- Ping Clean: payments PR 4, saving a card at booking (A-4; payments plan signed off by Carl
-- on 8 Nov 2026). Stripe TEST mode only. Nothing is charged here.
--
--   stripe_customer_for(profile)            server: the customer's Stripe customer id, if any
--   stripe_link_customer(profile, cus_…)    server: remember it (one per customer, first wins)
--   stripe_card_saved(series, cus_…, pm_…)  server (webhook): the card for that block, checked
--                                           against the block's own customer
--   series_card_saved(series)               the customer: "Card saved" for their own block

create function public.stripe_customer_for(p_profile uuid) returns text
language sql stable security definer set search_path = '' as $$
  select stripe_customer_id from private.customer_billing where customer_id = p_profile
$$;

-- First one wins, so two checkouts at once can't leave a customer with two Stripe ids in
-- Ping. Only customers get one. Returns the id Ping keeps.
create function public.stripe_link_customer(p_profile uuid, p_stripe_customer text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  kept text;
begin
  if not exists (select 1 from public.profiles where id = p_profile and role = 'customer') then
    raise exception 'Only customers have a saved card' using errcode = '42501';
  end if;
  perform set_config('app.actor', 'stripe', true);
  insert into private.customer_billing (customer_id, stripe_customer_id)
  values (p_profile, p_stripe_customer)
  on conflict (customer_id) do nothing;
  select stripe_customer_id into kept from private.customer_billing where customer_id = p_profile;
  return kept;
end $$;

-- From the setup_intent.succeeded webhook. The block's id comes from the SetupIntent's
-- metadata, which Ping set itself; it is still checked: the Stripe customer that saved the
-- card must be the one Ping linked to that block's customer, or nothing is stored.
--   'saved' · 'no_series' (unknown or ended block) · 'mismatch' (someone else's customer)
create function public.stripe_card_saved(
  p_series uuid, p_stripe_customer text, p_payment_method text,
  p_brand text, p_last4 text, p_exp_month smallint, p_exp_year smallint
) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.series;
  linked text;
begin
  perform set_config('app.actor', 'stripe-webhook', true);
  select * into s from public.series where id = p_series;
  if not found or s.status = 'ended' then
    return 'no_series';
  end if;
  select stripe_customer_id into linked from private.customer_billing where customer_id = s.customer_id for update;
  if linked is distinct from p_stripe_customer then
    return 'mismatch';
  end if;
  insert into public.series_billing (series_id, stripe_payment_method_id)
  values (s.id, p_payment_method)
  on conflict (series_id) do update set stripe_payment_method_id = excluded.stripe_payment_method_id;
  -- The newest card is the customer's card from now on (one card per customer, C13).
  update private.customer_billing
     set default_payment_method_id = p_payment_method, card_brand = left(p_brand, 20), card_last4 = p_last4,
         card_exp_month = p_exp_month, card_exp_year = p_exp_year
   where customer_id = s.customer_id;
  return 'saved';
end $$;

-- "Card saved" on the customer's booking page. False for anyone else's block.
create function public.series_card_saved(p_series uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.series_billing b join public.series s on s.id = b.series_id
    where b.series_id = p_series and s.customer_id = (select auth.uid()) and b.stripe_payment_method_id is not null)
$$;

revoke all on function public.stripe_customer_for(uuid), public.stripe_link_customer(uuid, text),
  public.stripe_card_saved(uuid, text, text, text, text, smallint, smallint), public.series_card_saved(uuid)
  from public, anon, authenticated;
grant execute on function public.stripe_customer_for(uuid), public.stripe_link_customer(uuid, text),
  public.stripe_card_saved(uuid, text, text, text, text, smallint, smallint) to service_role;
grant execute on function public.series_card_saved(uuid) to authenticated;
