create or replace function private.link_invited_cleaner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare employee public.staff;
begin
  if not (new.raw_app_meta_data ? 'cleanma_employee_id') then return new; end if;
  select * into employee from public.staff
    where id = (new.raw_app_meta_data->>'cleanma_employee_id')::uuid
    and company_id = (new.raw_app_meta_data->>'cleanma_company_id')::uuid
    for update;
  if employee.id is null or not employee.is_active or employee.profile_id is not null
     or (case when nullif(employee.email,'') is not null then
       lower(employee.email) is distinct from lower(new.email)
     else nullif(new.phone,'') is null
       or regexp_replace(employee.phone,'[^0-9]','','g') is distinct from regexp_replace(new.phone,'[^0-9]','','g')
     end) then
    raise exception 'Employee is no longer eligible for provisioning';
  end if;
  insert into public.profiles(id, company_id, role, full_name, is_active, must_change_password)
    values(new.id, employee.company_id, 'cleaner', employee.name, true, true);
  update public.staff set profile_id = new.id where id = employee.id;
  return new;
end $$;
