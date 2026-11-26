-- Keep prior Checkout claims so late Stripe deliveries can be attributed safely.
-- The existing per-company advisory lock serializes claims, and only a single
-- unresolved Checkout may be resumed. No workspace or entitlement is backfilled.
alter table private.cleanma_billing_claims drop constraint cleanma_billing_claims_company_id_key;
create index cleanma_billing_claims_company_created_idx on private.cleanma_billing_claims(company_id,created_at desc,id desc);

alter table private.cleanma_subscription_bindings
  add column claim_id uuid references private.cleanma_billing_claims(id),
  add column observed_at timestamptz;
-- The previous schema allowed exactly one claim per company.
update private.cleanma_subscription_bindings b
set claim_id=c.id from private.cleanma_billing_claims c where c.company_id=b.company_id;

create or replace function public.cleanma_payment_store(action text,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare company uuid:=(payload->>'company')::uuid; uid uuid:=(payload->>'user')::uuid; row_state private.cleanma_oauth_states; claim private.cleanma_billing_claims;
 binding private.cleanma_subscription_bindings;
 previous private.cleanma_billing_claims;
 event_time bigint;
 observed timestamptz;
 stripe_status text;
 period_end timestamptz;
begin
 if action='binding' then return(select to_jsonb(b) from private.cleanma_subscription_bindings b where company_id=company);end if;
 if action='subscription' then return (select to_jsonb(s) from public.subscriptions s where company_id=company);end if;
 if action='status' then return (select coalesce(jsonb_agg(jsonb_build_object('provider',provider,'account_id',account_id,'connected',true,'updated_at',updated_at)),'[]'::jsonb) from private.cleanma_connections where company_id=company);end if;
 if action='connection' then return(select to_jsonb(c) from private.cleanma_connections c where company_id=company and provider=payload->>'provider');end if;
 if action='state' then
  if not exists(select 1 from public.profiles where id=uid and company_id=company and role='owner' and is_active) then raise exception 'OWNER_REQUIRED';end if;
  insert into private.cleanma_oauth_states(hash,company_id,user_id,provider) values(payload->>'hash',company,uid,payload->>'provider');return '{}'::jsonb;
 end if;
 if action='consume_state' then delete from private.cleanma_oauth_states where hash=payload->>'hash' returning * into row_state;if row_state.expires_at>now() then return to_jsonb(row_state);end if;return null;end if;
 if action='save_connection' then
  if not exists(select 1 from public.profiles where id=uid and company_id=company and role='owner' and is_active) then raise exception 'OWNER_REQUIRED';end if;
  insert into private.cleanma_connections(company_id,provider,account_id,ciphertext) values(company,payload->>'provider',payload->>'account_id',payload->>'ciphertext') on conflict(company_id,provider) do update set account_id=excluded.account_id,ciphertext=excluded.ciphertext,updated_at=now();return '{}'::jsonb;
 end if;
 if action='claim' then
  perform pg_advisory_xact_lock(hashtextextended(company::text,0));
  if not exists(select 1 from public.profiles where id=uid and company_id=company and role='owner' and is_active) then raise exception 'OWNER_REQUIRED';end if;
  select * into binding from private.cleanma_subscription_bindings where company_id=company;
  if binding.status not in ('cancelled','inactive','incomplete') then raise exception 'SUBSCRIPTION_EXISTS';end if;
  select * into claim from private.cleanma_billing_claims where company_id=company order by created_at desc,id desc limit 1;
  if claim.id is not null and
     ((claim.created_at>now()-interval '25 hours' and not (coalesce(binding.claim_id=claim.id,false) and binding.status in ('cancelled','inactive')))
       or binding.status='incomplete') then
   if claim.user_id<>uid or claim.plan<>payload->>'plan' or claim.interval<>payload->>'interval' then raise exception 'CHECKOUT_PENDING';end if;
   return to_jsonb(claim);
  end if;
  insert into private.cleanma_billing_claims(company_id,user_id,plan,interval,price)
    values(company,uid,payload->>'plan',payload->>'interval',payload->>'price') returning * into claim;
  return to_jsonb(claim);
 end if;
 if action='apply_subscription' then
  select * into claim from private.cleanma_billing_claims where id=(payload->>'claim_id')::uuid;
  if claim.id is null then raise exception 'UNKNOWN_CHECKOUT';end if;
  company:=claim.company_id;
  perform pg_advisory_xact_lock(hashtextextended(company::text,0));
  if exists(select 1 from private.cleanma_stripe_events where event_id=payload->>'event_id') then return '{}'::jsonb;end if;
  select * into binding from private.cleanma_subscription_bindings where company_id=company;
  event_time:=(payload->>'event_created')::bigint;
  observed:=(payload->>'observed_at')::timestamptz;
  stripe_status:=payload->>'status';
  period_end:=(payload->>'period_end')::timestamptz;
  if stripe_status is null or stripe_status not in ('active','incomplete','inactive','past_due','cancelled')
      or (stripe_status='active' and period_end is null)
      or (payload ? 'company_id' and (payload->>'company_id')::uuid is distinct from company) then
   raise exception 'INVALID_SUBSCRIPTION_SNAPSHOT';
  end if;

  if binding.subscription_id=payload->>'subscription_id' then
   if binding.customer_id is distinct from payload->>'customer_id' or (binding.claim_id is not null and binding.claim_id<>claim.id) then
    raise exception 'SUBSCRIPTION_CONFLICT';
   end if;
   if (binding.observed_at is not null and observed is not null and binding.observed_at>=observed) or
      (observed is null and binding.last_event>event_time) or
      (binding.status='cancelled' and stripe_status<>'cancelled') then
    insert into private.cleanma_stripe_events(event_id) values(payload->>'event_id') on conflict do nothing;
    return '{}'::jsonb;
   end if;
  else
   if binding.claim_id is not null then
    select * into previous from private.cleanma_billing_claims where id=binding.claim_id;
    if (claim.created_at,claim.id)<(previous.created_at,previous.id) then
     insert into private.cleanma_stripe_events(event_id) values(payload->>'event_id') on conflict do nothing;
     return '{}'::jsonb;
    end if;
   end if;
   if binding.subscription_id is not null and
      (binding.claim_id=claim.id or binding.status not in ('cancelled','inactive')) then
    raise exception 'SUBSCRIPTION_CONFLICT';
   end if;
   if payload ? 'price_id' and (payload->>'price_id' is distinct from claim.price or payload->>'plan' is distinct from claim.plan) then
    raise exception 'INVALID_SUBSCRIPTION_SNAPSHOT';
   end if;
  end if;

  insert into private.cleanma_subscription_bindings(company_id,subscription_id,customer_id,status,last_event,claim_id,observed_at)
    values(company,payload->>'subscription_id',payload->>'customer_id',stripe_status,event_time,claim.id,observed)
    on conflict(company_id) do update set subscription_id=excluded.subscription_id,customer_id=excluded.customer_id,
      status=case when excluded.status='incomplete' and cleanma_subscription_bindings.subscription_id=excluded.subscription_id
         and cleanma_subscription_bindings.status in ('active','past_due') then cleanma_subscription_bindings.status else excluded.status end,
      last_event=greatest(cleanma_subscription_bindings.last_event,excluded.last_event),claim_id=excluded.claim_id,
      observed_at=coalesce(excluded.observed_at,cleanma_subscription_bindings.observed_at);

  -- Neither an unfinished Checkout nor an unpaid first invoice consumes an unexpired app trial.
  if stripe_status<>'incomplete' and (stripe_status='active' or not exists(
     select 1 from public.subscriptions where company_id=company and status='trialing' and trial_ends_at>now()
  )) then
   insert into public.subscriptions(company_id,plan,status,current_period_end,updated_at)
    values(company,payload->>'plan',stripe_status,period_end,now())
    on conflict(company_id) do update set plan=excluded.plan,status=excluded.status,current_period_end=excluded.current_period_end,updated_at=now();
   update public.companies set plan=payload->>'plan' where id=company and plan is distinct from payload->>'plan';
  end if;
  insert into private.cleanma_stripe_events(event_id) values(payload->>'event_id');
  return '{}'::jsonb;
 end if;
 raise exception 'INVALID_ACTION';
end;$$;
revoke all on function public.cleanma_payment_store(text,jsonb) from public,anon,authenticated;
grant execute on function public.cleanma_payment_store(text,jsonb) to service_role;
