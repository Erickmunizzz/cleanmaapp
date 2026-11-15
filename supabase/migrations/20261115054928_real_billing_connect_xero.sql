create table private.cleanma_oauth_states(hash text primary key, company_id uuid not null references public.companies(id),user_id uuid not null references auth.users(id),provider text not null check(provider in ('stripe','xero')),expires_at timestamptz not null default now()+interval '10 minutes');
create table private.cleanma_connections(company_id uuid not null references public.companies(id),provider text not null check(provider in ('stripe','xero')),account_id text,ciphertext text not null,updated_at timestamptz not null default now(),primary key(company_id,provider));
create unique index cleanma_connected_account_unique on private.cleanma_connections(provider,account_id) where account_id is not null;
create table private.cleanma_billing_claims(id uuid primary key default gen_random_uuid(),company_id uuid not null unique references public.companies(id),user_id uuid not null references auth.users(id),plan text not null check(plan in ('starter','growth','scale')),interval text not null check(interval in ('month','year')),price text not null,created_at timestamptz not null default now());
create table private.cleanma_subscription_bindings(company_id uuid primary key references public.companies(id),subscription_id text not null unique,customer_id text not null,status text not null,last_event bigint not null default 0);
create table private.cleanma_stripe_events(event_id text primary key,created_at timestamptz not null default now());
alter table private.cleanma_oauth_states enable row level security;
alter table private.cleanma_connections enable row level security;
alter table private.cleanma_billing_claims enable row level security;
alter table private.cleanma_subscription_bindings enable row level security;
alter table private.cleanma_stripe_events enable row level security;
revoke all on private.cleanma_oauth_states,private.cleanma_connections,private.cleanma_billing_claims,private.cleanma_subscription_bindings,private.cleanma_stripe_events from public,anon,authenticated;
grant usage on schema private to service_role;
grant all on private.cleanma_oauth_states,private.cleanma_connections,private.cleanma_billing_claims,private.cleanma_subscription_bindings,private.cleanma_stripe_events to service_role;
create function public.cleanma_payment_store(action text,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare company uuid:=(payload->>'company')::uuid; uid uuid:=(payload->>'user')::uuid; row_state private.cleanma_oauth_states; claim private.cleanma_billing_claims; result jsonb;
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
  if exists(select 1 from private.cleanma_subscription_bindings where company_id=company and status not in ('cancelled','inactive')) then raise exception 'SUBSCRIPTION_EXISTS';end if;
  select * into claim from private.cleanma_billing_claims where company_id=company;
  if claim.id is not null and claim.created_at>now()-interval '25 hours' then
   if claim.user_id<>uid or claim.plan<>payload->>'plan' or claim.interval<>payload->>'interval' then raise exception 'CHECKOUT_PENDING';end if;
   return to_jsonb(claim);
  end if;
  delete from private.cleanma_billing_claims where company_id=company;
  insert into private.cleanma_billing_claims(company_id,user_id,plan,interval,price) values(company,uid,payload->>'plan',payload->>'interval',payload->>'price') returning * into claim;return to_jsonb(claim);
 end if;
 if action='apply_subscription' then
  select * into claim from private.cleanma_billing_claims where id=(payload->>'claim_id')::uuid;
  if claim.id is null then raise exception 'UNKNOWN_CHECKOUT';end if;
  company:=claim.company_id;perform pg_advisory_xact_lock(hashtextextended(company::text,0));
  if exists(select 1 from private.cleanma_stripe_events where event_id=payload->>'event_id') then return '{}'::jsonb;end if;
  if exists(select 1 from private.cleanma_subscription_bindings where company_id=company and subscription_id<>payload->>'subscription_id' and status not in ('cancelled','inactive')) then raise exception 'SUBSCRIPTION_CONFLICT';end if;
  if exists(select 1 from private.cleanma_subscription_bindings where company_id=company and last_event>(payload->>'event_created')::bigint) then return '{}'::jsonb;end if;
  insert into private.cleanma_subscription_bindings values(company,payload->>'subscription_id',payload->>'customer_id',payload->>'status',(payload->>'event_created')::bigint) on conflict(company_id) do update set subscription_id=excluded.subscription_id,customer_id=excluded.customer_id,status=excluded.status,last_event=excluded.last_event;
  insert into public.subscriptions(company_id,plan,status,current_period_end,updated_at) values(company,payload->>'plan',payload->>'status',(payload->>'period_end')::timestamptz,now()) on conflict(company_id) do update set plan=excluded.plan,status=excluded.status,current_period_end=excluded.current_period_end,updated_at=now();
  update public.companies set plan=payload->>'plan' where id=company;
  insert into private.cleanma_stripe_events(event_id) values(payload->>'event_id');return '{}'::jsonb;
 end if;
 raise exception 'INVALID_ACTION';
end;$$;
revoke all on function public.cleanma_payment_store(text,jsonb) from public,anon,authenticated;
grant execute on function public.cleanma_payment_store(text,jsonb) to service_role;
