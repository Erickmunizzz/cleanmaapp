-- Demo entities deliberately have no foreign keys to operational companies/clients/jobs.
create table private.cleanma_demo_companies (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null unique references auth.users(id) on delete cascade,
 name text not null default 'BrightSpark Cleaning Services', is_demo boolean not null default true check(is_demo),
 demo_date date not null default (now() at time zone 'Europe/London')::date
);
create table private.cleanma_demo_records (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references private.cleanma_demo_companies(id) on delete cascade,
 kind text not null check(kind in ('cleaner','client','job','invoice','time_entry','payroll')),
 record_key text not null, is_demo boolean not null default true check(is_demo), data jsonb not null,
 unique(company_id,kind,record_key)
);
alter table private.cleanma_demo_companies enable row level security;
alter table private.cleanma_demo_records enable row level security;
revoke all on private.cleanma_demo_companies,private.cleanma_demo_records from public,anon,authenticated;
create policy demo_company_owner on private.cleanma_demo_companies for all to authenticated
 using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()) and is_demo);
create policy demo_record_owner on private.cleanma_demo_records for all to authenticated
 using(exists(select 1 from private.cleanma_demo_companies c where c.id=company_id and c.owner_id=(select auth.uid()) and c.is_demo))
 with check(is_demo and exists(select 1 from private.cleanma_demo_companies c where c.id=company_id and c.owner_id=(select auth.uid()) and c.is_demo));

-- Definer is restricted to private storage. Identity is checked on every call, never supplied by the browser.
create function private.manage_cleanma_demo(action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); ws private.cleanma_demo_companies; today date; week_start date;
 client_names text[]:=array['Oakwood Commercial Ltd','Regent Street Offices','The Manor House (Residential)'];
 addresses text[]:=array['42 Baker Street, London','15 Regent St, London','8 Willow Road, Oxford'];
 postcodes text[]:=array['W1U 7AJ','SW1Y 4LR','OX2 8BD'];
 cleaner_keys text[]:=array['sarah','david','emma'];
 names text[]:=array['Sarah Jenkins','David Miller','Emma Watson'];
 roles text[]:=array['Senior Cleaner','Cleaner','Field Supervisor'];
 payroll integer[]:=array[150000,140000,50000];
 prices integer[]:=array[45000,65000,22000];
 statuses text[]:=array['Completed','In Progress','Scheduled'];
 i integer; job_data jsonb; entry uuid;
begin
 if uid is null or not exists(select 1 from public.profiles where id=uid and role='owner' and is_active) then
  raise exception 'Only an active company owner can manage demo data' using errcode='42501';
 end if;
 if action not in ('read','generate','clear','clock_in','clock_out') or action is null then raise exception 'Invalid demo action';end if;
 perform pg_advisory_xact_lock(hashtextextended('demo:'||uid::text,0));
 select * into ws from private.cleanma_demo_companies where owner_id=uid and is_demo;
 if action='clear' then
  delete from private.cleanma_demo_records where company_id=ws.id and is_demo;
  delete from private.cleanma_demo_companies where id=ws.id and owner_id=uid and is_demo;
  return null;
 end if;
 if action='generate' and ws.id is null then
  insert into private.cleanma_demo_companies(owner_id) values(uid) returning * into ws;
  today:=ws.demo_date;week_start:=date_trunc('week',today::timestamp)::date;
  for i in 1..3 loop
   insert into private.cleanma_demo_records(company_id,kind,record_key,data) values
    (ws.id,'cleaner',cleaner_keys[i],jsonb_build_object('name',names[i],'role',roles[i],'status',case when i=3 then 'Day Off' else 'Present' end)),
    (ws.id,'client',i::text,jsonb_build_object('name',client_names[i],'address',addresses[i],'postcode',postcodes[i])),
    (ws.id,'job','today-'||i,jsonb_build_object('client_key',i::text,'cleaner_key',cleaner_keys[case when i=3 then 1 else i end],'date',today,'start',case when i=1 then '08:00' when i=2 then '08:30' else '14:00' end,'end',case when i=1 then '10:00' when i=2 then '16:30' else '16:00' end,'amount_pence',prices[i],'status',statuses[i],'archived',false)),
    (ws.id,'payroll',cleaner_keys[i],jsonb_build_object('cleaner_key',cleaner_keys[i],'month',to_char(today,'YYYY-MM'),'amount_pence',payroll[i]));
  end loop;
  insert into private.cleanma_demo_records(company_id,kind,record_key,data) values
   (ws.id,'time_entry','sarah-shift',jsonb_build_object('cleaner_key','sarah','date',today,'clock_in','08:00','clock_out','16:00')),
   (ws.id,'time_entry','david-shift',jsonb_build_object('cleaner_key','david','date',today,'clock_in','08:30','clock_out','16:30')),
   (ws.id,'invoice','today-1',jsonb_build_object('client_key','1','job_key','today-1','number','DEMO-1001','date',today,'status','Paid','amount_pence',45000));
  -- Eleven archived cleanings plus today's completed job = 12 this week, £5,850 paid revenue.
  for i in 1..11 loop
   job_data:=jsonb_build_object('client_key',((i%3)+1)::text,'cleaner_key','sarah','date',week_start+(i%((today-week_start)+1)),'start','06:00','end','07:00','amount_pence',case when i=11 then 50000 else 49000 end,'status','Completed','archived',true);
   insert into private.cleanma_demo_records(company_id,kind,record_key,data) values
    (ws.id,'job','history-'||i,job_data),
    (ws.id,'invoice','history-'||i,jsonb_build_object('client_key',((i%3)+1)::text,'job_key','history-'||i,'number','DEMO-'||(1001+i),'date',today,'status','Paid','amount_pence',case when i=11 then 50000 else 49000 end));
  end loop;
  for i in 1..4 loop
   insert into private.cleanma_demo_records(company_id,kind,record_key,data) values
    (ws.id,'job','sarah-next-'||i,jsonb_build_object('client_key',case when i%2=0 then '2' else '1' end,'cleaner_key','sarah','date',today+i,'start','08:00','end','16:00','amount_pence',45000,'status','Scheduled','archived',false));
  end loop;
 end if;
 if ws.id is null then return null;end if;
 if action='clock_in' then
  if exists(select 1 from private.cleanma_demo_records where company_id=ws.id and kind='time_entry' and data->>'cleaner_key'='sarah' and data->>'clock_out' is null) then raise exception 'Sarah is already clocked in';end if;
  insert into private.cleanma_demo_records(company_id,kind,record_key,data) values(ws.id,'time_entry',gen_random_uuid()::text,jsonb_build_object('cleaner_key','sarah','date',(now() at time zone 'Europe/London')::date,'clock_in',to_char(now() at time zone 'Europe/London','HH24:MI'),'clock_out',null));
 elsif action='clock_out' then
  select id into entry from private.cleanma_demo_records where company_id=ws.id and kind='time_entry' and data->>'cleaner_key'='sarah' and data->>'clock_out' is null limit 1;
  if entry is null then raise exception 'Sarah is not clocked in';end if;
  update private.cleanma_demo_records set data=jsonb_set(data,'{clock_out}',to_jsonb(to_char(now() at time zone 'Europe/London','HH24:MI'))) where id=entry and company_id=ws.id and is_demo;
 end if;
 return jsonb_build_object('company',to_jsonb(ws),'records',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'key',record_key,'kind',kind,'is_demo',is_demo,'data',data) order by kind,record_key),'[]'::jsonb) from private.cleanma_demo_records where company_id=ws.id and is_demo));
end;$$;
revoke all on function private.manage_cleanma_demo(text) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.manage_cleanma_demo(text) to authenticated;
create function public.cleanma_demo_workspace(action text) returns jsonb language sql security invoker set search_path='' as $$ select private.manage_cleanma_demo(action); $$;
revoke all on function public.cleanma_demo_workspace(text) from public,anon,authenticated;
grant execute on function public.cleanma_demo_workspace(text) to authenticated;
