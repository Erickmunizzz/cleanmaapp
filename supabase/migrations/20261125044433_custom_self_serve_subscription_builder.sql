-- Additive custom, client-priced subscriptions. Existing plans, authentication,
-- SaaS trial/paywall and prior recurring subscriptions are deliberately untouched.
create table public.custom_subscription_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  company_id uuid not null unique references public.companies(id),
  slug text not null unique check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug)<=110),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique(id,owner_id,company_id)
);

create table public.custom_client_subscriptions (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null,
  owner_id uuid not null references public.profiles(id),
  company_id uuid not null references public.companies(id),
  client_name text not null check(length(btrim(client_name)) between 2 and 120),
  client_email text not null check(length(client_email) between 3 and 254),
  client_phone text not null check(length(client_phone) between 5 and 30),
  cleaning_address text not null check(length(cleaning_address) between 6 and 240),
  postcode text not null check(length(postcode) between 4 and 11),
  visits_per_week smallint not null check(visits_per_week between 1 and 5),
  preferred_days text[] not null check(cardinality(preferred_days)=visits_per_week),
  start_time time not null,
  duration_hours smallint not null check(duration_hours between 2 and 6),
  price_per_visit_pence integer not null check(price_per_visit_pence between 100 and 1000000),
  monthly_amount_pence integer not null check(monthly_amount_pence=visits_per_week*price_per_visit_pence*4),
  status text not null default 'checkout_pending' check(status in (
    'checkout_pending','pending_approval','active','paused','past_due','canceled','declined')),
  owner_approved boolean not null default false,
  stripe_account_id text not null check(stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  stripe_subscription_id text unique,
  stripe_checkout_session_id text unique,
  next_billing_date date,
  scheduling_error text,
  schedule_version integer not null default 1 check(schedule_version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(link_id,owner_id,company_id)
    references public.custom_subscription_links(id,owner_id,company_id),
  unique(id,owner_id,company_id)
);
create index custom_clients_company_idx on public.custom_client_subscriptions(company_id,created_at desc);
create index custom_clients_portal_idx on public.custom_client_subscriptions(company_id,client_email,created_at desc);

-- Keep an immutable trail of skipped, canceled and rescheduled visits. Old jobs
-- are never deleted; cancellation sets their normal existing status field.
create table public.custom_subscription_visits (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.custom_client_subscriptions(id),
  owner_id uuid not null references public.profiles(id),
  company_id uuid not null references public.companies(id),
  schedule_version integer not null,
  service_date date not null,
  scheduled_at timestamptz not null,
  job_id uuid unique references public.jobs(id) on delete set null,
  status text not null default 'pending_approval' check(status in (
    'pending_approval','scheduled','skipped','canceled')),
  created_at timestamptz not null default now(),
  unique(subscription_id,service_date,schedule_version),
  foreign key(subscription_id,owner_id,company_id)
    references public.custom_client_subscriptions(id,owner_id,company_id)
);
create index custom_visits_future_idx
  on public.custom_subscription_visits(subscription_id,scheduled_at)
  where status in ('scheduled','pending_approval');

-- Short-lived bearer links are hashed at rest and never readable by browsers.
create table public.custom_subscription_portal_tokens (
  token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
  subscription_id uuid not null references public.custom_client_subscriptions(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index custom_portal_token_latest_idx
  on public.custom_subscription_portal_tokens(subscription_id,created_at desc);

create table private.custom_subscription_events (
  event_id text primary key,
  subscription_id uuid not null references public.custom_client_subscriptions(id),
  received_at timestamptz not null default now()
);

alter table public.custom_subscription_links enable row level security;
alter table public.custom_client_subscriptions enable row level security;
alter table public.custom_subscription_visits enable row level security;
alter table public.custom_subscription_portal_tokens enable row level security;
alter table private.custom_subscription_events enable row level security;

revoke all on public.custom_subscription_links,public.custom_client_subscriptions,
  public.custom_subscription_visits,public.custom_subscription_portal_tokens
  from public,anon,authenticated;
grant select on public.custom_subscription_links,public.custom_client_subscriptions,
  public.custom_subscription_visits to authenticated;
grant all on public.custom_subscription_links,public.custom_client_subscriptions,
  public.custom_subscription_visits,public.custom_subscription_portal_tokens to service_role;
revoke all on private.custom_subscription_events from public,anon,authenticated;
grant usage on schema private to service_role;
grant all on private.custom_subscription_events to service_role;

create policy custom_link_owner_read on public.custom_subscription_links for select to authenticated
using(owner_id=(select auth.uid()) and exists(select 1 from public.profiles p
  where p.id=(select auth.uid()) and p.company_id=custom_subscription_links.company_id
    and p.role='owner' and p.is_active));
create policy custom_client_owner_read on public.custom_client_subscriptions for select to authenticated
using(owner_id=(select auth.uid()) and exists(select 1 from public.profiles p
  where p.id=(select auth.uid()) and p.company_id=custom_client_subscriptions.company_id
    and p.role='owner' and p.is_active));
create policy custom_visit_owner_read on public.custom_subscription_visits for select to authenticated
using(owner_id=(select auth.uid()) and exists(select 1 from public.profiles p
  where p.id=(select auth.uid()) and p.company_id=custom_subscription_visits.company_id
    and p.role='owner' and p.is_active));

-- Only callable by service_role. All changes to the calendar are in one
-- transaction; repeat events and schedule refreshes never duplicate a visit.
create function public.cleanma_custom_schedule(target_subscription uuid)
returns integer language plpgsql security invoker set search_path='' as $$
declare
  s record;
  service_day date;
  at_time timestamptz;
  new_job uuid;
  generated integer:=0;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('custom:'||target_subscription::text,0));
  select * into s from public.custom_client_subscriptions where id=target_subscription for update;
  if s.id is null or s.status not in ('active','pending_approval') then return 0; end if;
  for service_day in select d::date from pg_catalog.generate_series(
    (now() at time zone 'Europe/London')::date::timestamp,
    ((now() at time zone 'Europe/London')::date+interval '4 months')::timestamp,
    interval '1 day') d
    where to_char(d,'FMDay')=any(s.preferred_days) order by d
  loop
    at_time:=(service_day+s.start_time) at time zone 'Europe/London';
    if at_time<=now() or exists(select 1 from public.custom_subscription_visits v
      where v.subscription_id=s.id and v.service_date=service_day and v.status='skipped')
      or exists(select 1 from public.custom_subscription_visits v
      where v.subscription_id=s.id and v.service_date=service_day
        and v.schedule_version=s.schedule_version) then continue; end if;
    insert into public.jobs(company_id,title,status,scheduled_date,duration_minutes,notes)
    values(s.company_id,
      case when s.owner_approved then s.client_name||' · Custom subscription'
      else 'Pending owner approval: '||s.client_name end,
      'scheduled',at_time,s.duration_hours*60,
      'Subscription '||s.id::text||' · '||s.cleaning_address||', '||s.postcode||
      ' · '||s.duration_hours||' hours') returning id into new_job;
    insert into public.custom_subscription_visits(subscription_id,owner_id,company_id,
      schedule_version,service_date,scheduled_at,job_id,status)
    values(s.id,s.owner_id,s.company_id,s.schedule_version,service_day,at_time,new_job,
      case when s.owner_approved then 'scheduled' else 'pending_approval' end);
    generated:=generated+1;
  end loop;
  return generated;
end $$;
revoke all on function public.cleanma_custom_schedule(uuid) from public,anon,authenticated;
grant execute on function public.cleanma_custom_schedule(uuid) to service_role;

create function public.cleanma_custom_sync_subscription(
  target_subscription uuid,target_event text,target_status text,
  target_stripe_subscription text,target_next_billing date,target_account text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s record; v record; final_status text;
begin
  if target_status not in ('checkout_pending','pending_approval','paused','past_due','canceled')
    or length(target_event)<5 then raise exception 'INVALID_STATUS'; end if;
  select * into s from public.custom_client_subscriptions where id=target_subscription for update;
  if s.id is null or s.stripe_account_id is distinct from target_account
    or (s.stripe_subscription_id is not null and s.stripe_subscription_id is distinct from target_stripe_subscription)
  then raise exception 'SUBSCRIPTION_ACCOUNT_MISMATCH'; end if;
  insert into private.custom_subscription_events(event_id,subscription_id)
    values(target_event,target_subscription) on conflict do nothing;
  if not found then return jsonb_build_object('processed',false); end if;
  final_status:=case when s.status='declined' then 'declined'
    when target_status='pending_approval' and s.owner_approved then 'active'
    else target_status end;
  update public.custom_client_subscriptions set status=final_status,
    stripe_subscription_id=coalesce(stripe_subscription_id,target_stripe_subscription),
    next_billing_date=coalesce(target_next_billing,next_billing_date),updated_at=now()
    where id=target_subscription;
  if final_status in ('active','pending_approval') then
    for v in select * from public.custom_subscription_visits
      where subscription_id=target_subscription and schedule_version=s.schedule_version
        and status='canceled' and scheduled_at>now() for update
    loop
      update public.jobs set status='scheduled' where id=v.job_id and status='canceled';
      update public.custom_subscription_visits set status=case when s.owner_approved then 'scheduled' else 'pending_approval' end
        where id=v.id;
    end loop;
    begin
      perform public.cleanma_custom_schedule(target_subscription);
      update public.custom_client_subscriptions set scheduling_error=null where id=target_subscription;
    exception when others then
      update public.custom_client_subscriptions set scheduling_error=
        'Payment succeeded, but calendar scheduling could not complete. Review your job allowance and schedule this client manually.'
        where id=target_subscription;
    end;
  else
    for v in select * from public.custom_subscription_visits
      where subscription_id=target_subscription and status in ('scheduled','pending_approval')
        and scheduled_at>now() for update
    loop
      update public.jobs set status='canceled' where id=v.job_id and status='scheduled';
      update public.custom_subscription_visits set status='canceled' where id=v.id;
    end loop;
  end if;
  return jsonb_build_object('processed',true,'status',final_status);
end $$;
revoke all on function public.cleanma_custom_sync_subscription(uuid,text,text,text,date,text)
  from public,anon,authenticated;
grant execute on function public.cleanma_custom_sync_subscription(uuid,text,text,text,date,text) to service_role;

create function public.cleanma_custom_accept(target_subscription uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s record; v record;
begin
  select * into s from public.custom_client_subscriptions where id=target_subscription for update;
  if s.id is null or s.status not in ('pending_approval','active') then raise exception 'NOT_READY_FOR_APPROVAL'; end if;
  update public.custom_client_subscriptions set owner_approved=true,status='active',updated_at=now()
    where id=s.id;
  for v in select * from public.custom_subscription_visits where subscription_id=s.id
    and status='pending_approval' and scheduled_at>now() for update loop
    update public.jobs set title=s.client_name||' · Custom subscription'
      where id=v.job_id and status='scheduled';
    update public.custom_subscription_visits set status='scheduled' where id=v.id;
  end loop;
  perform public.cleanma_custom_schedule(target_subscription);
  return jsonb_build_object('updated',true,'status','active');
end $$;
revoke all on function public.cleanma_custom_accept(uuid) from public,anon,authenticated;
grant execute on function public.cleanma_custom_accept(uuid) to service_role;

create function public.cleanma_custom_skip(target_subscription uuid,target_week boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare first_visit record; v record; skipped integer:=0;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('custom:'||target_subscription::text,0));
  select * into first_visit from public.custom_subscription_visits where subscription_id=target_subscription
    and status in ('scheduled','pending_approval') and scheduled_at>now()
    order by scheduled_at,id limit 1 for update;
  if first_visit.id is null then return jsonb_build_object('skipped',0); end if;
  for v in select * from public.custom_subscription_visits where subscription_id=target_subscription
    and status in ('scheduled','pending_approval') and scheduled_at>=first_visit.scheduled_at
    and (not target_week or scheduled_at<first_visit.scheduled_at+interval '7 days')
    order by scheduled_at for update loop
    update public.custom_subscription_visits set status='skipped' where id=v.id;
    update public.jobs set status='canceled' where id=v.job_id and status='scheduled';
    skipped:=skipped+1;
    if not target_week then exit; end if;
  end loop;
  return jsonb_build_object('skipped',skipped);
end $$;
revoke all on function public.cleanma_custom_skip(uuid,boolean) from public,anon,authenticated;
grant execute on function public.cleanma_custom_skip(uuid,boolean) to service_role;

create function public.cleanma_custom_owner_cancel(target_subscription uuid,target_declined boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v record;
begin
  update public.custom_client_subscriptions set status=case when target_declined then 'declined' else 'canceled' end,
    updated_at=now() where id=target_subscription;
  if not found then raise exception 'SUBSCRIPTION_UNAVAILABLE'; end if;
  for v in select * from public.custom_subscription_visits where subscription_id=target_subscription
    and status in ('pending_approval','scheduled') and scheduled_at>now() for update loop
    update public.jobs set status='canceled' where id=v.job_id and status='scheduled';
    update public.custom_subscription_visits set status='canceled' where id=v.id;
  end loop;
  return jsonb_build_object('updated',true);
end $$;
revoke all on function public.cleanma_custom_owner_cancel(uuid,boolean) from public,anon,authenticated;
grant execute on function public.cleanma_custom_owner_cancel(uuid,boolean) to service_role;

create function public.cleanma_custom_reconfigure(
  target_subscription uuid,target_version integer,target_visits integer,target_days text[],
  target_time time,target_hours integer,target_visit_pence integer,target_month_pence integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s record; v record;
begin
  select * into s from public.custom_client_subscriptions where id=target_subscription for update;
  if s.id is null or s.schedule_version<>target_version or s.status not in ('active','pending_approval')
    then raise exception 'SUBSCRIPTION_CHANGED'; end if;
  if target_visits not between 1 and 5 or cardinality(target_days)<>target_visits
    or (select count(distinct d) from unnest(target_days) d)<>target_visits
    or exists(select 1 from unnest(target_days) d where d<>all(array[
      'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']))
    or target_hours not between 2 and 6 or target_visit_pence not between 100 and 1000000
    or target_month_pence<>target_visits*target_visit_pence*4 then raise exception 'INVALID_SELECTION'; end if;
  for v in select * from public.custom_subscription_visits where subscription_id=s.id
    and status in ('pending_approval','scheduled') and scheduled_at>now() for update loop
    update public.jobs set status='canceled' where id=v.job_id and status='scheduled';
    update public.custom_subscription_visits set status='canceled' where id=v.id;
  end loop;
  update public.custom_client_subscriptions set visits_per_week=target_visits,preferred_days=target_days,
    start_time=target_time,duration_hours=target_hours,price_per_visit_pence=target_visit_pence,
    monthly_amount_pence=target_month_pence,schedule_version=schedule_version+1,updated_at=now()
    where id=s.id;
  begin
    perform public.cleanma_custom_schedule(target_subscription);
    update public.custom_client_subscriptions set scheduling_error=null where id=target_subscription;
  exception when others then
    update public.custom_client_subscriptions set scheduling_error=
      'Subscription saved, but the calendar could not be refreshed. Contact the cleaning business.'
      where id=target_subscription;
  end;
  return jsonb_build_object('updated',true,'schedule_version',target_version+1);
end $$;
revoke all on function public.cleanma_custom_reconfigure(uuid,integer,integer,text[],time,integer,integer,integer)
  from public,anon,authenticated;
grant execute on function public.cleanma_custom_reconfigure(uuid,integer,integer,text[],time,integer,integer,integer)
  to service_role;
