-- Server-owned account binding; browsers cannot change where company payments go.
alter table public.companies add column stripe_account_id text unique
  check (stripe_account_id is null or stripe_account_id ~ '^acct_[A-Za-z0-9]+$');

create function private.protect_company_stripe_account() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if current_user not in ('service_role','postgres','supabase_admin') then
    if (TG_OP='INSERT' and new.stripe_account_id is not null) then
      raise exception 'Stripe account bindings are server-managed' using errcode='42501';
    elsif TG_OP='UPDATE' then
      if new.stripe_account_id is distinct from old.stripe_account_id then
        raise exception 'Stripe account bindings are server-managed' using errcode='42501';
      end if;
    end if;
  end if;
  return new;
end;$$;
revoke all on function private.protect_company_stripe_account() from public,anon,authenticated;
create trigger companies_protect_stripe_account before insert or update on public.companies
for each row execute function private.protect_company_stripe_account();

create table private.cleanma_express_provisions (
  company_id uuid primary key references public.companies(id),
  provision_id uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);
alter table private.cleanma_express_provisions enable row level security;
revoke all on private.cleanma_express_provisions from public,anon,authenticated;
grant all on private.cleanma_express_provisions to service_role;

create function public.cleanma_stripe_express_store(action text,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  company uuid := (payload->>'company')::uuid;
  uid uuid := (payload->>'user')::uuid;
  account text;
  provision private.cleanma_express_provisions;
begin
  if not exists(select 1 from public.profiles where id=uid and company_id=company and role='owner' and is_active) then
    raise exception 'OWNER_REQUIRED';
  end if;
  if action='get' then
    return (select jsonb_build_object('stripe_account_id',stripe_account_id) from public.companies where id=company);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('express:'||company::text,0));
  select stripe_account_id into account from public.companies where id=company for update;
  if action='begin' then
    if account is not null then return jsonb_build_object('stripe_account_id',account);end if;
    insert into private.cleanma_express_provisions(company_id) values(company) on conflict(company_id) do nothing;
    select * into provision from private.cleanma_express_provisions where company_id=company;
    return jsonb_build_object('stripe_account_id',null,'provision_id',provision.provision_id,'created_at',provision.created_at);
  end if;
  if action='save' then
    if not exists(select 1 from private.cleanma_express_provisions where company_id=company and provision_id=(payload->>'provision_id')::uuid) then
      raise exception 'INVALID_PROVISION';
    end if;
    if payload->>'account_id' is null or (payload->>'account_id') !~ '^acct_[A-Za-z0-9]+$' then raise exception 'INVALID_ACCOUNT';end if;
    if account is not null and account<>payload->>'account_id' then raise exception 'ACCOUNT_ALREADY_BOUND';end if;
    update public.companies set stripe_account_id=payload->>'account_id' where id=company;
    return '{}'::jsonb;
  end if;
  raise exception 'INVALID_ACTION';
end;$$;
revoke all on function public.cleanma_stripe_express_store(text,jsonb) from public,anon,authenticated;
grant execute on function public.cleanma_stripe_express_store(text,jsonb) to service_role;
