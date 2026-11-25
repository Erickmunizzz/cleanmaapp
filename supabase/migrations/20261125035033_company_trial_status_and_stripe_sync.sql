-- Additive, company-scoped trial state. Existing subscriptions remain the billing source of truth.
alter table public.companies
  add column if not exists trial_ends_at timestamptz,
  add column if not exists status text,
  add column if not exists stripe_customer_id text;

alter table public.companies
  add constraint company_billing_status_allowed
  check (status in ('trial', 'active', 'blocked'));

-- Preserve paying companies. Do not restart an existing expired trial.
update public.companies c set
  status = case
    when s.status = 'active' and (s.current_period_end is null or s.current_period_end > now()) then 'active'
    when s.status = 'trialing' and s.trial_ends_at > now() then 'trial'
    when s.company_id is null then 'trial'
    else 'blocked'
  end,
  trial_ends_at = coalesce(c.trial_ends_at, s.trial_ends_at,
    case when s.company_id is null then now() + interval '14 days'
         else coalesce(s.trial_started_at, c.created_at) + interval '14 days' end),
  stripe_customer_id = coalesce(c.stripe_customer_id, b.customer_id)
from (select id from public.companies) existing
left join public.subscriptions s on s.company_id = existing.id
left join private.cleanma_subscription_bindings b on b.company_id = existing.id
where c.id = existing.id and (c.status is null or c.trial_ends_at is null or c.stripe_customer_id is null)
  and c.status is null;

update public.companies set trial_ends_at = now() + interval '14 days'
where trial_ends_at is null;
update public.companies set status = 'trial' where status is null;
alter table public.companies alter column status set default 'trial';
alter table public.companies alter column status set not null;

-- Legacy companies lacking a subscription receive one trial, once, during migration.
insert into public.subscriptions(company_id, plan, status, trial_started_at, trial_ends_at)
select c.id, 'growth', 'trialing', now(), c.trial_ends_at
from public.companies c
where not exists (select 1 from public.subscriptions s where s.company_id = c.id)
on conflict(company_id) do nothing;

create or replace function private.set_company_trial_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.status := 'trial';
  new.trial_ends_at := coalesce(new.created_at, now()) + interval '14 days';
  new.stripe_customer_id := null;
  return new;
end $$;
revoke all on function private.set_company_trial_defaults() from public, anon, authenticated;
create trigger company_trial_defaults before insert on public.companies
for each row execute function private.set_company_trial_defaults();

-- Prevent clients from self-upgrading by updating a public company row.
create or replace function private.protect_company_billing_columns()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and
     (new.status is distinct from old.status or
      new.trial_ends_at is distinct from old.trial_ends_at or
      new.stripe_customer_id is distinct from old.stripe_customer_id) then
    raise exception 'Company billing fields are managed by the server';
  end if;
  return new;
end $$;
revoke all on function private.protect_company_billing_columns() from public, anon, authenticated;
create trigger protect_company_billing_columns before update on public.companies
for each row execute function private.protect_company_billing_columns();

-- The verified Stripe webhook already updates public.subscriptions and the private binding.
-- Synchronize from that authoritative write, never from the browser/Checkout success URL.
create or replace function private.sync_company_subscription_state()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.companies c set
    status = case
      when new.status = 'active' and (new.current_period_end is null or new.current_period_end > now()) then 'active'
      when new.status = 'trialing' and new.trial_ends_at > now() then 'trial'
      else 'blocked'
    end,
    trial_ends_at = coalesce(new.trial_ends_at, c.trial_ends_at),
    stripe_customer_id = coalesce((select b.customer_id from private.cleanma_subscription_bindings b
                                  where b.company_id = new.company_id), c.stripe_customer_id)
  where c.id = new.company_id;
  return new;
end $$;
revoke all on function private.sync_company_subscription_state() from public, anon, authenticated;
create trigger sync_company_subscription_state after insert or update of status, trial_ends_at, current_period_end
on public.subscriptions for each row execute function private.sync_company_subscription_state();

-- A normal self-service signup provisions a company and profile. Invited cleaners
-- are provisioned by the existing employee-invite trigger and must not get a company.
create or replace function private.provision_owner_on_signup()
returns trigger language plpgsql security definer set search_path = '' as $$
declare tenant uuid;
begin
  if coalesce(new.raw_app_meta_data ? 'cleanma_employee_id', false)
     or coalesce(new.raw_user_meta_data->>'cleanma_invited_cleaner', 'false') = 'true'
  then return new; end if;
  if exists(select 1 from public.profiles p where p.id = new.id) then return new; end if;
  insert into public.companies(name, owner_user_id)
  values('New cleaning business', new.id) returning id into tenant;
  insert into public.profiles(id, company_id, role, full_name, is_active)
  values(new.id, tenant, 'owner',
    coalesce(nullif(split_part(new.email, '@', 1), ''), 'Owner'), true);
  return new;
end $$;
revoke all on function private.provision_owner_on_signup() from public, anon, authenticated;
create trigger cleanma_provision_owner_signup after insert on auth.users
for each row execute function private.provision_owner_on_signup();

-- Lazy expiry is atomic and idempotent; each authenticated request enforces the deadline.
create or replace function public.refresh_my_trial_status()
returns void language plpgsql security definer set search_path = '' as $$
declare tenant uuid;
begin
  select p.company_id into tenant from public.profiles p
  where p.id = auth.uid() and p.is_active limit 1;
  if tenant is null then return; end if;
  update public.companies c set status = 'blocked'
  where c.id = tenant and c.status in ('trial', 'active') and
    exists (select 1 from public.subscriptions s where s.company_id = c.id and
      ((s.status = 'trialing' and (s.trial_ends_at is null or s.trial_ends_at < now())) or
       (s.status = 'active' and s.current_period_end is not null and s.current_period_end < now()) or
       s.status not in ('trialing', 'active')));
  update public.companies c set status = 'blocked'
  where c.id = tenant and c.status = 'trial' and c.trial_ends_at < now();
end $$;
revoke all on function public.refresh_my_trial_status() from public, anon;
grant execute on function public.refresh_my_trial_status() to authenticated;

create or replace function public.current_subscription_access()
returns jsonb language sql stable security definer set search_path = '' as $$
select jsonb_build_object(
  'role', p.role,
  'plan', case when p.id = '66665614-7860-4e68-aaf9-3884a0513734' then 'scale' else s.plan end,
  'status', c.status,
  'trialEndsAt', c.trial_ends_at,
  'active', coalesce(
      (c.status = 'active' and s.status = 'active' and
        (s.current_period_end is null or s.current_period_end > now()))
      or (c.status = 'trial' and c.trial_ends_at >= now() and s.status = 'trialing'
        and s.plan = 'growth' and s.trial_ends_at >= now()), false)
)
from public.profiles p
join public.companies c on c.id = p.company_id
left join public.subscriptions s on s.company_id = c.id
where p.id = auth.uid() and p.is_active
$$;
revoke all on function public.current_subscription_access() from public, anon;
grant execute on function public.current_subscription_access() to authenticated;
