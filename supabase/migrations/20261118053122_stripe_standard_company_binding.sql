create function public.cleanma_bind_stripe_standard(target_company uuid, owner_id uuid, account_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if account_id is null or account_id !~ '^acct_[A-Za-z0-9]+$' then
    raise exception 'INVALID_ACCOUNT';
  end if;
  update public.companies c set stripe_account_id=account_id
  where c.id=target_company and exists (
    select 1 from public.profiles p where p.id=owner_id and p.company_id=c.id
      and p.role='owner' and p.is_active
  );
  if not found then raise exception 'OWNER_REQUIRED'; end if;
  return '{}'::jsonb;
end;
$$;
revoke all on function public.cleanma_bind_stripe_standard(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.cleanma_bind_stripe_standard(uuid,uuid,text) to service_role;
