-- Preserve existing workspaces, subscriptions, and employee-created identities.
-- The company INSERT (not the browser) remains the source of the Growth trial.
alter function private.provision_growth_trial() set timezone to 'UTC';

create function private.provision_confirmed_owner()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  workspace uuid;
  account_name text;
begin
  -- The self-service marker is opt-in only. It grants no rights to any
  -- existing company, and no client-provided role/company is ever used.
  if new.email_confirmed_at is null
     or nullif(pg_catalog.btrim(new.email), '') is null
     or new.is_anonymous
     or new.invited_at is not null
     or new.raw_app_meta_data->>'provider' is distinct from 'email'
     or coalesce(new.raw_app_meta_data ?| array['cleanma_employee_id', 'cleanma_company_id'], false)
     or new.raw_user_meta_data #> '{cleanma_owner_signup,version}' is distinct from '1'::jsonb
  then return new; end if;

  if exists (select 1 from public.profiles where id = new.id)
     or exists (select 1 from public.staff where profile_id = new.id)
     or exists (select 1 from public.staff_invites
         where lower(btrim(email)) = lower(btrim(new.email))
           and accepted_at is null and expires_at > now())
  then return new; end if;

  account_name := coalesce(nullif(btrim(left(split_part(new.email, '@', 1), 80)), ''), 'CleanMa owner');
  insert into public.companies(name, created_at) values (account_name || ' workspace', clock_timestamp())
    returning id into workspace;
  insert into public.profiles (id, company_id, role, full_name)
    values (new.id, workspace, 'owner', account_name);
  return new;
end $$;

revoke all on function private.provision_confirmed_owner() from public, anon, authenticated;
create trigger cleanma_owner_on_confirmation
  after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function private.provision_confirmed_owner();

-- Covers Auth instances that create an already-verified self-service identity.
-- The current production instance requires email confirmation.
create trigger cleanma_owner_on_verified_insert
  after insert on auth.users
  for each row when (new.email_confirmed_at is not null)
  execute function private.provision_confirmed_owner();

create or replace function public.current_subscription_access()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'role', p.role,
    'plan', case when p.id='66665614-7860-4e68-aaf9-3884a0513734' then 'scale' else s.plan end,
    'status', s.status,
    'active', demo.bypass or coalesce(
      (s.status='active' and (s.current_period_end is null or s.current_period_end>now()))
      or (s.status='trialing' and s.plan='growth' and s.trial_ends_at>now()), false),
    'trialEndsAt', s.trial_ends_at,
    'accessEndsAt', case when not demo.bypass then
      case s.status when 'trialing' then s.trial_ends_at when 'active' then s.current_period_end end
    end
  )
  from public.profiles p
  left join public.subscriptions s on s.company_id=p.company_id
  cross join lateral (
    select p.id in ('66665614-7860-4e68-aaf9-3884a0513734','5b5737e3-cb3c-4f1e-9f42-1bb791251ef7') as bypass
  ) demo
  where p.id=auth.uid() and p.is_active
$$;

-- Gate every existing operation that depends on the assigned Cleaner helper,
-- including the SECURITY DEFINER checklist and NFC operations. Self-profile
-- access remains available for password changes; owner permissions are unchanged.
create or replace function private.is_company_cleaner(target_company_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case when exists (
    select 1 from public.profiles p join public.staff s
      on s.profile_id=p.id and s.company_id=p.company_id and s.is_active
    where p.id=auth.uid() and p.company_id=target_company_id and p.role='cleaner'
      and p.is_active and not p.must_change_password
  ) then coalesce((public.current_subscription_access()->>'active')::boolean,false)
  else false end
$$;
