-- Run against a database with an active owner. All generated data is rolled back.
begin;
do $test$
declare uid uuid; other_uid uuid; snapshot jsonb; again jsonb; value jsonb; before_counts bigint[]; after_counts bigint[]; denied boolean:=false;
begin
 select id into uid from public.profiles where role='owner' and is_active order by id limit 1;
 if uid is null then raise exception 'Test requires an active owner';end if;
 select array[(select count(*) from public.companies),(select count(*) from public.staff),(select count(*) from public.jobs),(select count(*) from public.clients),(select count(*) from public.invoices)] into before_counts;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 execute 'set local role authenticated';
 perform public.cleanma_demo_workspace('clear');
 snapshot:=public.cleanma_demo_workspace('generate');
 again:=public.cleanma_demo_workspace('generate');
 if snapshot->'company'->>'id'<>again->'company'->>'id' or jsonb_array_length(snapshot->'records')<>jsonb_array_length(again->'records') then raise exception 'Generation is not idempotent';end if;
 if snapshot->'company'->>'name'<>'BrightSpark Cleaning Services' or (snapshot->'company'->>'is_demo')::boolean is not true then raise exception 'Invalid demo company';end if;
 if (select count(*) from jsonb_array_elements(snapshot->'records')r where r->>'kind'='cleaner')<>3 then raise exception 'Invalid cleaner count';end if;
 if (select count(*) from jsonb_array_elements(snapshot->'records')r where r->>'kind'='client')<>3 then raise exception 'Invalid client count';end if;
 if exists(select 1 from jsonb_array_elements(snapshot->'records')r where (r->>'is_demo')::boolean is not true) then raise exception 'Unmarked record';end if;
 if (select count(*) from jsonb_array_elements(snapshot->'records')r where r->>'kind'='job' and r->'data'->>'status'='Completed')<>12 then raise exception 'Invalid completion count';end if;
 if (select sum((r->'data'->>'amount_pence')::integer) from jsonb_array_elements(snapshot->'records')r where r->>'kind'='payroll')<>340000 then raise exception 'Invalid payroll';end if;
 if (select sum((r->'data'->>'amount_pence')::integer) from jsonb_array_elements(snapshot->'records')r where r->>'kind'='invoice' and r->'data'->>'status'='Paid')<>585000 then raise exception 'Invalid revenue';end if;
 value:=public.cleanma_demo_workspace('clock_in');
 if (select count(*) from jsonb_array_elements(value->'records')r where r->>'kind'='time_entry' and r->'data'->>'cleaner_key'='sarah' and r->'data'->>'clock_out' is null)<>1 then raise exception 'Clock in failed';end if;
 begin perform public.cleanma_demo_workspace('clock_in');exception when raise_exception then if SQLERRM='Sarah is already clocked in' then denied:=true;else raise;end if;end;
 if not denied then raise exception 'Duplicate clock-in accepted';end if;
 value:=public.cleanma_demo_workspace('clock_out');
 if exists(select 1 from jsonb_array_elements(value->'records')r where r->>'kind'='time_entry' and r->'data'->>'clock_out' is null) then raise exception 'Clock out failed';end if;
 -- Another owner gets a separate workspace and can only clear their own demo.
 execute 'reset role';
 select id into other_uid from public.profiles where role='owner' and is_active and id<>uid order by id limit 1;
 execute 'set local role authenticated';
 if other_uid is not null then
  perform set_config('request.jwt.claim.sub',other_uid::text,true);
  value:=public.cleanma_demo_workspace('generate');
  if value->'company'->>'id'=snapshot->'company'->>'id' then raise exception 'Owners share a demo workspace';end if;
  perform public.cleanma_demo_workspace('clear');
  perform set_config('request.jwt.claim.sub',uid::text,true);
  value:=public.cleanma_demo_workspace('read');
  if value->'company'->>'id' is distinct from snapshot->'company'->>'id' then raise exception 'Other owner cleared this demo';end if;
 end if;
 -- Another identity cannot access this owner's demo, even via a forged request context.
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);denied:=false;
 begin perform public.cleanma_demo_workspace('read');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Unknown identity accepted';end if;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 perform public.cleanma_demo_workspace('clear');
 if public.cleanma_demo_workspace('read') is not null then raise exception 'Clear did not remove workspace';end if;
 execute 'reset role';
 if exists(select 1 from private.cleanma_demo_records where company_id=(snapshot->'company'->>'id')::uuid) then raise exception 'Clear left orphan records';end if;
 select array[(select count(*) from public.companies),(select count(*) from public.staff),(select count(*) from public.jobs),(select count(*) from public.clients),(select count(*) from public.invoices)] into after_counts;
 if before_counts<>after_counts then raise exception 'Operational tables were affected';end if;
 if has_function_privilege('anon','public.cleanma_demo_workspace(text)','EXECUTE') then raise exception 'Anonymous RPC access enabled';end if;
 if has_table_privilege('authenticated','private.cleanma_demo_records','DELETE') then raise exception 'Direct demo deletion enabled';end if;
end;$test$;
rollback;
select 'PASS: seed, repeat generation, clock, owner guard, clear, no orphan rows and operational isolation' as demo_tests;
