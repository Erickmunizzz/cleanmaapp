-- Independent customer-facing recurring billing. No existing tables are changed.
create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  company_id uuid not null references public.companies(id),
  name text not null check (length(btrim(name)) between 2 and 100),
  description text not null default '' check (length(description) <= 500),
  monthly_price numeric(10,2) not null check (monthly_price between 1 and 1000000),
  cleans_per_month smallint not null check (cleans_per_month between 1 and 8),
  fixed_day text not null check (fixed_day in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
  fixed_time time not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(id, owner_id, company_id)
);
create index subscription_plans_owner_idx on public.subscription_plans(owner_id, created_at desc);

create table public.client_subscriptions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  owner_id uuid not null references public.profiles(id),
  company_id uuid not null references public.companies(id),
  client_name text not null check (length(btrim(client_name)) between 2 and 120),
  client_email text not null check (length(client_email) between 3 and 254),
  client_phone text not null check (length(client_phone) between 5 and 30),
  stripe_account_id text not null check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  status text not null default 'paused' check (status in ('active','paused','canceled','past_due')),
  fixed_day text not null check (fixed_day in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
  fixed_time time not null,
  stripe_subscription_id text unique,
  stripe_checkout_session_id text unique,
  next_billing_date date,
  checkout_pending boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key(plan_id, owner_id, company_id)
    references public.subscription_plans(id, owner_id, company_id),
  unique(id, owner_id, company_id),
  unique(id, owner_id)
);
create index client_subscriptions_owner_idx on public.client_subscriptions(owner_id, created_at desc);
create index client_subscriptions_company_status_idx on public.client_subscriptions(company_id, status);

-- A new mapping table links generated shifts to the existing calendar without
-- adding columns or removing events from public.jobs.
create table public.client_subscription_cleans (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.client_subscriptions(id),
  owner_id uuid not null references public.profiles(id),
  company_id uuid not null references public.companies(id),
  service_date date not null,
  scheduled_at timestamptz not null,
  job_id uuid unique references public.jobs(id) on delete set null,
  status text not null default 'scheduled' check(status in ('scheduled','skipped','canceled')),
  created_at timestamptz not null default now(),
  unique(subscription_id, service_date),
  foreign key(subscription_id, owner_id, company_id)
    references public.client_subscriptions(id, owner_id, company_id)
);
create index client_subscription_cleans_future_idx
  on public.client_subscription_cleans(subscription_id, scheduled_at) where status='scheduled';

create table public.client_subscription_alerts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  subscription_id uuid not null references public.client_subscriptions(id),
  message text not null,
  event_id text not null,
  created_at timestamptz not null default now(),
  unique(subscription_id, event_id),
  foreign key(subscription_id, owner_id)
    references public.client_subscriptions(id, owner_id)
);
create index client_subscription_alerts_owner_idx on public.client_subscription_alerts(owner_id, created_at desc);

create table private.client_subscription_stripe_events (
  event_id text primary key,
  subscription_id uuid not null references public.client_subscriptions(id),
  processed_at timestamptz not null default now()
);
grant usage on schema private to service_role;

alter table public.subscription_plans enable row level security;
alter table public.client_subscriptions enable row level security;
alter table public.client_subscription_cleans enable row level security;
alter table public.client_subscription_alerts enable row level security;
alter table private.client_subscription_stripe_events enable row level security;

grant select, insert, update(active) on public.subscription_plans to authenticated;
grant select on public.client_subscriptions, public.client_subscription_cleans,
  public.client_subscription_alerts to authenticated;
grant all on public.subscription_plans, public.client_subscriptions,
  public.client_subscription_cleans, public.client_subscription_alerts to service_role;
grant all on private.client_subscription_stripe_events to service_role;
revoke all on private.client_subscription_stripe_events from public, anon, authenticated;

create policy owner_plans_select on public.subscription_plans for select to authenticated
using (owner_id=(select auth.uid()) and exists(
  select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=subscription_plans.company_id
   and p.role='owner' and p.is_active));
create policy owner_plans_insert on public.subscription_plans for insert to authenticated
with check (owner_id=(select auth.uid()) and exists(
  select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=subscription_plans.company_id
   and p.role='owner' and p.is_active));
create policy owner_plans_update on public.subscription_plans for update to authenticated
using (owner_id=(select auth.uid()) and exists(
  select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=subscription_plans.company_id
   and p.role='owner' and p.is_active))
with check (owner_id=(select auth.uid()) and exists(
  select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=subscription_plans.company_id
   and p.role='owner' and p.is_active));
create policy owner_subscriptions_select on public.client_subscriptions for select to authenticated
using (owner_id=(select auth.uid()) and exists(
  select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=client_subscriptions.company_id
   and p.role='owner' and p.is_active));
create policy owner_cleans_select on public.client_subscription_cleans for select to authenticated
using (owner_id=(select auth.uid()) and exists(
  select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=client_subscription_cleans.company_id
   and p.role='owner' and p.is_active));
create policy owner_alerts_select on public.client_subscription_alerts for select to authenticated
using (owner_id=(select auth.uid()) and exists(
  select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=(
    select cs.company_id from public.client_subscriptions cs where cs.id=client_subscription_alerts.subscription_id)
   and p.role='owner' and p.is_active));

-- The service-role-only function runs a deterministic rolling four-month
-- schedule in Europe/London, preserving already skipped days on every renewal.
create or replace function public.cleanma_generate_client_cleans(target_subscription uuid)
returns integer language plpgsql security invoker set search_path='' as $$
declare
  s record;
  month_index integer;
  month_first date;
  candidate record;
  ordinal integer;
  target_count integer;
  primary_day integer;
  second_day integer;
  scheduled timestamptz;
  job uuid;
  generated integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('client-cleans:'||target_subscription::text, 0));
  select cs.*, p.name as plan_name, p.cleans_per_month into s
    from public.client_subscriptions cs join public.subscription_plans p on p.id=cs.plan_id
    where cs.id=target_subscription for update of cs;
  if s.id is null or s.status<>'active' then return 0; end if;
  primary_day := array_position(array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'], s.fixed_day);
  second_day := (primary_day + 2) % 7 + 1;
  for month_index in 0..3 loop
    month_first := date_trunc('month', now() at time zone 'Europe/London')::date + (month_index||' months')::interval;
    ordinal := 0;
    target_count := 0;
    for candidate in
      select d::date as service_date from pg_catalog.generate_series(
        month_first::timestamp,
        (month_first + interval '1 month - 1 day')::timestamp, interval '1 day') d
      where extract(isodow from d)::integer=primary_day
        or (s.cleans_per_month>4 and extract(isodow from d)::integer=second_day)
      order by d
    loop
      ordinal := ordinal+1;
      if s.cleans_per_month=2 and ordinal not in (1,3) then continue; end if;
      if target_count>=s.cleans_per_month then exit; end if;
      target_count := target_count+1;
      scheduled := (candidate.service_date + s.fixed_time) at time zone 'Europe/London';
      if scheduled <= now() or exists(
        select 1 from public.client_subscription_cleans c
         where c.subscription_id=target_subscription and c.service_date=candidate.service_date) then continue; end if;
      insert into public.jobs(company_id, title, status, scheduled_date, notes)
      values(s.company_id, s.client_name||' · '||s.plan_name, 'scheduled', scheduled,
        'Recurring CleanMa client subscription: '||target_subscription::text)
      returning id into job;
      insert into public.client_subscription_cleans(subscription_id, owner_id, company_id,
        service_date, scheduled_at, job_id)
      values(s.id, s.owner_id, s.company_id, candidate.service_date, scheduled, job);
      generated := generated+1;
    end loop;
  end loop;
  return generated;
end $$;
revoke all on function public.cleanma_generate_client_cleans(uuid) from public, anon, authenticated;
grant execute on function public.cleanma_generate_client_cleans(uuid) to service_role;

-- Stripe updates, cancellation, pause/resume and scheduling commit atomically.
-- Replayed webhooks do not create duplicate jobs or duplicate alerts.
create or replace function public.cleanma_sync_client_subscription(
  target_subscription uuid, target_event text, target_status text,
  target_stripe_subscription text, target_next_billing date, target_account text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  s record;
  c record;
  inserted integer;
begin
  if target_status not in ('active','paused','canceled','past_due') or length(target_event)<5
    then raise exception 'INVALID_SUBSCRIPTION_STATUS'; end if;
  select cs.* into s from public.client_subscriptions cs
    where cs.id=target_subscription for update of cs;
  if s.id is null or s.stripe_account_id is distinct from target_account
     or s.stripe_subscription_id is not null and s.stripe_subscription_id is distinct from target_stripe_subscription
  then raise exception 'SUBSCRIPTION_ACCOUNT_MISMATCH'; end if;
  insert into private.client_subscription_stripe_events(event_id, subscription_id)
    values(target_event, target_subscription) on conflict do nothing;
  if not found then return jsonb_build_object('processed', false); end if;
  update public.client_subscriptions set status=target_status,
    stripe_subscription_id=coalesce(stripe_subscription_id,target_stripe_subscription),
    next_billing_date=coalesce(target_next_billing,next_billing_date), checkout_pending=false
  where id=target_subscription;
  if target_status='active' then
    for c in select * from public.client_subscription_cleans
      where subscription_id=target_subscription and status='canceled' and scheduled_at>now()
      for update
    loop
      if c.job_id is not null then
        update public.jobs set status='scheduled' where id=c.job_id and status='canceled';
      end if;
      update public.client_subscription_cleans set status='scheduled' where id=c.id;
    end loop;
    begin
      perform public.cleanma_generate_client_cleans(target_subscription);
    exception when others then
      -- Do not reject an already paid invoice if the job calendar is full;
      -- the owner sees a durable scheduling warning instead.
      insert into public.client_subscription_alerts(owner_id,subscription_id,message,event_id)
      values(s.owner_id,s.id,'Payment succeeded for '||s.client_name||
        ', but automatic scheduling could not complete. Review job limits and schedule the remaining visits.',target_event)
      on conflict do nothing;
    end;
  else
    for c in select * from public.client_subscription_cleans
      where subscription_id=target_subscription and status='scheduled' and scheduled_at>now()
      for update
    loop
      if c.job_id is not null then
        update public.jobs set status='canceled' where id=c.job_id and status='scheduled';
      end if;
      update public.client_subscription_cleans set status='canceled' where id=c.id;
    end loop;
    if target_status='past_due' and s.status is distinct from target_status then
      insert into public.client_subscription_alerts(owner_id,subscription_id,message,event_id)
      values(s.owner_id,s.id,'Client payment failed for '||s.client_name||' ('||s.client_email||'). Review the payment method in Stripe.',target_event)
      on conflict do nothing;
    end if;
  end if;
  return jsonb_build_object('processed', true, 'status', target_status);
end $$;
revoke all on function public.cleanma_sync_client_subscription(uuid,text,text,text,date,text)
  from public, anon, authenticated;
grant execute on function public.cleanma_sync_client_subscription(uuid,text,text,text,date,text)
  to service_role;

create or replace function public.cleanma_skip_next_client_clean(target_subscription uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c record;
begin
  perform pg_advisory_xact_lock(hashtextextended('client-cleans:'||target_subscription::text, 0));
  select * into c from public.client_subscription_cleans
  where subscription_id=target_subscription and status='scheduled' and scheduled_at>now()
  order by scheduled_at, id limit 1 for update;
  if c.id is null then return jsonb_build_object('skipped',false); end if;
  update public.client_subscription_cleans set status='skipped' where id=c.id;
  if c.job_id is not null then
    update public.jobs set status='canceled' where id=c.job_id and status='scheduled';
  end if;
  return jsonb_build_object('skipped',true,'service_date',c.service_date);
end $$;
revoke all on function public.cleanma_skip_next_client_clean(uuid) from public,anon,authenticated;
grant execute on function public.cleanma_skip_next_client_clean(uuid) to service_role;
