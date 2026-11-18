create or replace function private.change_subscription_usage(target_company uuid, resource_name text, usage_month date, delta integer)
returns void language plpgsql security definer set search_path = '' as $$
declare current_plan text; maximum integer; total integer;
begin
  -- Plan changes wait for active quota operations to finish.
  select plan into current_plan from public.companies where id=target_company for share;
  if not found then return; end if; -- Parent cascade deletion.
  maximum := case when resource_name='staff' then case current_plan when 'scale' then 20 when 'growth' then 12 else 5 end
    else case current_plan when 'scale' then 1000 when 'growth' then 570 else 230 end end;
  insert into private.subscription_usage(company_id,resource,month,used)
    values(target_company,resource_name,usage_month,greatest(delta,0))
  on conflict(company_id,resource,month) do update
    set used=private.subscription_usage.used+delta
    where delta < 0 or private.subscription_usage.used+delta <= maximum
  returning used into total;
  if total is null or (delta > 0 and total > maximum) then
    raise exception using errcode='P0001', message=format('PLAN_LIMIT: Your %s plan allows %s %s. %s', current_plan, maximum, case resource_name when 'staff' then 'active staff members' else 'cleanings per month' end, case current_plan when 'scale' then 'Contact support for more capacity.' else 'Upgrade your plan to add more.' end),
      detail=format('%s limit %s for %s (%s)',resource_name,maximum,current_plan,usage_month);
  end if;
end;
$$;
