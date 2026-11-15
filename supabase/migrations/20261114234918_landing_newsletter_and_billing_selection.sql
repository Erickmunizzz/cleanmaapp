grant usage on schema private to service_role;
create table private.marketing_admins(user_id uuid primary key references auth.users(id) on delete cascade);
alter table private.marketing_admins enable row level security;
revoke all on private.marketing_admins from public,anon,authenticated;
insert into private.marketing_admins(user_id)
select u.id from auth.users u join public.profiles p on p.id=u.id
where lower(u.email)='royyallstore@gmail.com' and u.email_confirmed_at is not null and p.role='owner' and p.is_active;
create function private.is_marketing_admin() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from private.marketing_admins a where a.user_id=auth.uid()); $$;
revoke all on function private.is_marketing_admin() from public,anon; grant execute on function private.is_marketing_admin() to authenticated;
create function public.marketing_admin_access() returns boolean language sql stable security invoker set search_path='' as $$select private.is_marketing_admin();$$;
revoke all on function public.marketing_admin_access() from public,anon; grant execute on function public.marketing_admin_access() to authenticated;
create table public.newsletter_subscribers(
 id uuid primary key default gen_random_uuid(), email text not null unique,
 status text not null default 'subscribed' check(status in ('subscribed','unsubscribed')),
 consent_version text not null default 'cleanma-marketing-v1', consented_at timestamptz not null default now(),
 source text not null default 'landing_footer',created_at timestamptz not null default now(),
 check(email=lower(btrim(email)) and length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);
alter table public.newsletter_subscribers enable row level security;
revoke all on public.newsletter_subscribers from public,anon,authenticated;
grant select on public.newsletter_subscribers to authenticated; grant all on public.newsletter_subscribers to service_role;
create policy newsletter_marketing_read on public.newsletter_subscribers for select to authenticated using((select private.is_marketing_admin()));
create index newsletter_subscribers_created_idx on public.newsletter_subscribers(created_at desc,id);
create table private.newsletter_rate_limits(ip_hash text primary key, window_started_at timestamptz not null, attempts integer not null);
alter table private.newsletter_rate_limits enable row level security;
revoke all on private.newsletter_rate_limits from public,anon,authenticated; grant all on private.newsletter_rate_limits to service_role;
create function public.subscribe_newsletter(email_input text,ip_hash_input text) returns void language plpgsql security invoker set search_path='' as $$
declare attempts_now integer;
begin
 if length(ip_hash_input)<>64 or email_input<>lower(btrim(email_input)) or length(email_input)>254 or email_input !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid submission';end if;
 insert into private.newsletter_rate_limits values(ip_hash_input,now(),1)
 on conflict(ip_hash) do update set attempts=case when newsletter_rate_limits.window_started_at<now()-interval '15 minutes' then 1 else newsletter_rate_limits.attempts+1 end,window_started_at=case when newsletter_rate_limits.window_started_at<now()-interval '15 minutes' then now() else newsletter_rate_limits.window_started_at end returning attempts into attempts_now;
 if attempts_now>5 then raise exception 'RATE_LIMIT';end if;
 insert into public.newsletter_subscribers(email) values(email_input) on conflict(email) do nothing;
 delete from private.newsletter_rate_limits where window_started_at<now()-interval '1 day';
end;$$;
revoke all on function public.subscribe_newsletter(text,text) from public,anon,authenticated; grant execute on function public.subscribe_newsletter(text,text) to service_role;
create table public.subscription_selections(
 user_id uuid primary key references auth.users(id) on delete cascade,
 company_id uuid references public.companies(id), plan text not null check(plan in ('starter','growth','scale')),
 billing_interval text not null check(billing_interval in ('month','year')),
 currency text not null check(currency='brl'), amount_cents integer not null check(amount_cents>0),
 state text not null default 'pending_checkout' check(state in ('pending_checkout','checkout_created','completed')),
 updated_at timestamptz not null default now()
);
alter table public.subscription_selections enable row level security;
revoke all on public.subscription_selections from public,anon,authenticated;
grant select on public.subscription_selections to authenticated;grant all on public.subscription_selections to service_role;
create policy billing_selection_read on public.subscription_selections for select to authenticated using(user_id=(select auth.uid()) or (select private.is_marketing_admin()));
create index subscription_selections_company_idx on public.subscription_selections(company_id);
create function private.save_subscription_selection(plan_input text,interval_input text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); tenant uuid; user_role text; cents integer; result jsonb;
begin
 if uid is null then raise exception 'Authentication required';end if;
 if plan_input not in ('starter','growth','scale') or interval_input not in ('month','year') or plan_input is null or interval_input is null then raise exception 'Invalid plan';end if;
 select p.company_id,p.role into tenant,user_role from public.profiles p where p.id=uid and p.is_active;
 if user_role is not null and user_role<>'owner' then raise exception 'Only owners can choose a subscription';end if;
 cents:=case when interval_input='year' then case plan_input when 'starter' then 92870 when 'growth' then 185750 else 309590 end else case plan_input when 'starter' then 8999 when 'growth' then 17999 else 29999 end end;
 insert into public.subscription_selections(user_id,company_id,plan,billing_interval,currency,amount_cents)
 values(uid,tenant,plan_input,interval_input,'brl',cents)
 on conflict(user_id) do update set company_id=excluded.company_id,plan=excluded.plan,billing_interval=excluded.billing_interval,currency='brl',amount_cents=excluded.amount_cents,state='pending_checkout',updated_at=now();
 select to_jsonb(s) into result from public.subscription_selections s where s.user_id=uid;return result;
end;$$;
revoke all on function private.save_subscription_selection(text,text) from public,anon;grant execute on function private.save_subscription_selection(text,text) to authenticated;
create function public.save_subscription_selection(plan_input text,interval_input text) returns jsonb language sql security invoker set search_path='' as $$select private.save_subscription_selection(plan_input,interval_input);$$;
revoke all on function public.save_subscription_selection(text,text) from public,anon;grant execute on function public.save_subscription_selection(text,text) to authenticated;
create function public.my_subscription_selection() returns jsonb language sql stable security invoker set search_path='' as $$select to_jsonb(s) from public.subscription_selections s where user_id=auth.uid();$$;
revoke all on function public.my_subscription_selection() from public,anon;grant execute on function public.my_subscription_selection() to authenticated;
create function public.marketing_subscribers(page_input integer default 0) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if not private.is_marketing_admin() then raise exception 'Access denied';end if;
 if page_input<0 or page_input>100000 then raise exception 'Invalid page';end if;
 return jsonb_build_object('total',(select count(*) from public.newsletter_subscribers),'items',(select coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb) from (select id,email,status,consented_at,created_at,source from public.newsletter_subscribers order by created_at desc,id limit 50 offset page_input*50) n));
end;$$;
revoke all on function public.marketing_subscribers(integer) from public,anon;grant execute on function public.marketing_subscribers(integer) to authenticated;
