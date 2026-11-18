alter table public.profiles add column must_change_password boolean not null default false;
alter table public.staff
  add column hourly_rate numeric(10,2) check (hourly_rate >= 0),
  add column assigned_client_id uuid,
  add column invitation_sent_at timestamptz,
  add constraint staff_assigned_client_fkey foreign key (company_id, assigned_client_id)
    references public.clients(company_id, id) on delete set null (assigned_client_id);

-- GoTrue creates the Auth account and the company binding in one transaction.
create function private.link_invited_cleaner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare employee public.staff;
begin
  if not (new.raw_app_meta_data ? 'cleanma_employee_id') then return new; end if;
  select * into employee from public.staff
    where id = (new.raw_app_meta_data->>'cleanma_employee_id')::uuid
    and company_id = (new.raw_app_meta_data->>'cleanma_company_id')::uuid
    for update;
  if employee.id is null or not employee.is_active or employee.profile_id is not null
     or new.email is null or lower(employee.email) is distinct from lower(new.email) then
    raise exception 'Employee is no longer eligible for provisioning';
  end if;
  insert into public.profiles(id, company_id, role, full_name, is_active, must_change_password)
    values(new.id, employee.company_id, 'cleaner', employee.name, true, true);
  update public.staff set profile_id = new.id where id = employee.id;
  return new;
end $$;
create trigger cleanma_link_invited_cleaner after insert on auth.users
for each row execute function private.link_invited_cleaner();

create function private.complete_cleaner_password_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set must_change_password = false
  where id = new.id and role = 'cleaner' and must_change_password;
  return new;
end $$;
create trigger cleanma_complete_password_change after update of encrypted_password on auth.users
for each row when (new.encrypted_password is distinct from old.encrypted_password
  and new.encrypted_password is not null and new.encrypted_password <> '')
execute function private.complete_cleaner_password_change();

create function private.protect_cleaner_access_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_table_name = 'profiles' then
      if tg_op = 'INSERT' and new.must_change_password then
        raise exception 'Password status is managed by CleanMa' using errcode='42501';
      elsif tg_op = 'UPDATE' and old.must_change_password is distinct from new.must_change_password then
        raise exception 'Password status is managed by CleanMa' using errcode='42501';
      end if;
    elsif tg_op = 'INSERT' and new.invitation_sent_at is not null then
      raise exception 'Invitation status is managed by CleanMa' using errcode='42501';
    elsif tg_op = 'UPDATE' and old.invitation_sent_at is distinct from new.invitation_sent_at then
      raise exception 'Invitation status is managed by CleanMa' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
create trigger cleanma_protect_password_status before insert or update on public.profiles
for each row execute function private.protect_cleaner_access_fields();
create trigger cleanma_protect_invitation_status before insert or update on public.staff
for each row execute function private.protect_cleaner_access_fields();

create or replace function private.is_company_cleaner(target_company_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join public.staff s
    on s.profile_id=p.id and s.company_id=p.company_id and s.is_active
    where p.id=auth.uid() and p.company_id=target_company_id and p.role='cleaner'
    and p.is_active and not p.must_change_password
  );
$$;

create or replace function private.is_assigned_staff(target_staff_id uuid, target_company_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_company_cleaner(target_company_id) and exists (
    select 1 from public.staff s
    where s.id=target_staff_id and s.profile_id=auth.uid() and s.company_id=target_company_id and s.is_active
  );
$$;

create or replace function private.cleaner_subscription_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select case when p.role='cleaner' then
    private.is_company_cleaner(p.company_id)
    and coalesce((public.current_subscription_access()->>'active')::boolean,false)
    else true end from public.profiles p where p.id=auth.uid()), true);
$$;

-- Keep self-profile access so the login screen can read the password-change flag.
drop policy if exists staff_cleaner_select_self on public.staff;
drop policy if exists key_registers_cleaner_select_assigned on public.key_registers;
drop policy if exists key_registers_cleaner_update_assigned on public.key_registers;
drop policy if exists companies_select_member_or_owner on public.companies;
create policy companies_select_owner on public.companies for select to authenticated
using(private.is_company_owner(id));
drop policy if exists subscriptions_member_read on public.subscriptions;
create policy subscriptions_owner_read on public.subscriptions for select to authenticated
using(private.is_company_owner(company_id));

do $$ declare definition text; begin
  definition := pg_get_functiondef('public.cleaner_workspace()'::regprocedure);
  definition := replace(definition, '''customer'',c.name,', '');
  definition := replace(definition, ',''contact_name'',c.contact_person,''contact_phone'',c.phone', '');
  execute definition;
end $$;

revoke all on function private.link_invited_cleaner(),
  private.complete_cleaner_password_change(), private.protect_cleaner_access_fields()
  from public, anon, authenticated;

-- Existing signed links can finish, while new invitations use the owner endpoint.
drop policy if exists staff_invites_owner_insert on public.staff_invites;

do $$ declare definition text; begin
  definition := pg_get_functiondef('public.cleaner_quick_alert(text,text)'::regprocedure);
  definition := replace(definition, 'IF issue IS NULL', $guard$
  IF NOT private.cleaner_subscription_allowed() THEN
    RAISE EXCEPTION 'Active employee access required' USING ERRCODE='42501';
  END IF;
  IF issue IS NULL$guard$);
  execute definition;
end $$;
