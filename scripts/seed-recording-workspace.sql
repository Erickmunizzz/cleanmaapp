-- Explicit recording fixtures for the owner's existing workspace; no external messages/payments are sent.
begin;
do $seed$
declare owner_id uuid; cleaner_id uuid; company uuid; staff_ids uuid[]; client_ids uuid[]; sid uuid; cid uuid; jid uuid; i int; k int; remaining numeric; chunk numeric; day date:=(now() at time zone 'Europe/London')::date;
 names text[]:=array['Sarah Jenkins','David Miller','Emma Watson']; clients text[]:=array['Oakwood Commercial Ltd','Regent Street Offices','The Manor House (Residential)']; addresses text[]:=array['42 Baker Street','15 Regent Street','8 Willow Road'];
begin
 select u.id,p.company_id into owner_id,company from auth.users u join public.profiles p on p.id=u.id where lower(u.email)='royyallstore@gmail.com' and p.role='owner' and p.is_active;
 select u.id into cleaner_id from auth.users u join public.profiles p on p.id=u.id where lower(u.email)='friend.cleaner@teste.com' and p.company_id=company and p.role='cleaner' and p.is_active;
 if company is null or cleaner_id is null then raise exception 'Expected owner and cleaner must exist in the same company';end if;
 update public.profiles set full_name='Sarah Jenkins' where id=cleaner_id and company_id=company;
 update public.staff set name='Sarah Jenkins',role='Senior Cleaner' where profile_id=cleaner_id and company_id=company;
 perform pg_advisory_xact_lock(hashtextextended('recording-seed:'||company::text,0));
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 for i in 1..3 loop
  sid:=md5('cleanma-recording-v1:staff:'||i)::uuid;
  if i=1 then select id into sid from public.staff where profile_id=cleaner_id and company_id=company limit 1;sid:=coalesce(sid,md5('cleanma-recording-v1:staff:1')::uuid);end if;
  insert into public.staff(id,company_id,name,role,email,phone,profile_id,weekly_hours,employee_no) values(sid,company,names[i],(array['Senior Cleaner','Cleaner','Field Supervisor'])[i],case when i=1 then 'friend.cleaner@teste.com' else lower(split_part(names[i],' ',1))||'@example.invalid' end,'+44 7700 90000'||i,case when i=1 then cleaner_id else null end,40,'MOCK-UK-'||i) on conflict do nothing;
  staff_ids:=array_append(staff_ids,sid);
  cid:=md5('cleanma-recording-v1:client:'||i)::uuid;
  insert into public.clients(id,company_id,name,email,phone,address,city,contact_person,contact_language,customer_no,site_latitude,site_longitude) values(cid,company,clients[i],'facilities'||i||'@example.invalid','+44 7700 90001'||i,addresses[i],case when i=3 then 'Oxford' else 'London' end,(array['James Harper','Olivia Bennett','Charlotte Reed'])[i],'en-GB','MOCK-UK-'||i,case when i=3 then 51.778 else 51.523 end,case when i=3 then -1.279 else -0.158 end) on conflict do nothing;
  client_ids:=array_append(client_ids,cid);
  insert into public.client_locations(id,company_id,customer_id,label,address,city,postcode,is_main) values(md5('cleanma-recording-v1:location:'||i)::uuid,company,cid,'Main property',addresses[i],case when i=3 then 'Oxford' else 'London' end,(array['W1U 7AJ','SW1Y 4LR','OX2 8BD'])[i],true) on conflict do nothing;
  insert into public.staff_wages(id,company_id,staff_id,period_start,period_end,total_hours,hourly_rate) values(md5('cleanma-recording-v1:wage:'||i)::uuid,company,sid,date_trunc('month',day)::date,(date_trunc('month',day)+interval '1 month - 1 day')::date,80,(array[18.75,17.50,6.25])[i]) on conflict do nothing;
 end loop;
 for i in 1..24 loop
  jid:=md5('cleanma-recording-v1:job:'||i)::uuid;
  insert into public.jobs(id,company_id,client_id,staff_id,title,scheduled_date,status,priority,duration_minutes,notes,checklist,site_latitude,site_longitude,check_in_at,check_out_at,check_in_latitude,check_in_longitude,check_out_latitude,check_out_longitude,created_at) values(jid,company,client_ids[(i%3)+1],staff_ids[case when i%3=0 then 2 else 1 end],'Cleaning service — '||addresses[(i%3)+1],(day-case when i<=16 then (i%7) when i<=19 then 0 else -(i%5) end)+time '08:00',case when i<=12 then 'completed' when i<=16 then 'cancelled' when i=17 then 'in_progress' else 'scheduled' end,'medium',120,'[MOCK UK] Office and residential cleaning. Secure keys with reception; follow COSHH guidance. Simulated GPS.', '[{"label":"Vacuum and mop floors","done":false},{"label":"Disinfect touch points","done":false},{"label":"Clean kitchens and washrooms","done":false},{"label":"Check supplies and secure property","done":false}]'::jsonb,51.523,-0.158,case when i<=12 or i=17 then day-case when i=17 then 0 else i%7 end+time '08:00' else null end,case when i<=12 then day-(i%7)+time '10:00' else null end,case when i<=12 or i=17 then 51.523 else null end,case when i<=12 or i=17 then -0.158 else null end,case when i<=12 then 51.523 else null end,case when i<=12 then -0.158 else null end,day-(i%7)+time '07:00') on conflict do nothing;
  if i<=15 then insert into public.invoices(id,company_id,customer_id,invoice_number,amount,status,due_date,created_at) values(md5('cleanma-recording-v1:invoice:'||i)::uuid,company,client_ids[(i%3)+1],'MOCK-UK-'||lpad(i::text,4,'0'),case when i<=12 then 487.50 else 650 end,case when i<=12 then 'paid' when i=13 then 'overdue' else 'sent' end,day+case when i=13 then -8 else 14 end,day-(i%7)+time '10:00') on conflict do nothing;end if;
 end loop;
 for i in 1..6 loop
  insert into public.materials(id,company_id,name,category,quantity,minimum_quantity,unit,storage_location,product_no) values(md5('cleanma-recording-v1:material:'||i)::uuid,company,(array['Eco-friendly disinfectant','Microfiber cloths','Vacuum bags','Nitrile gloves','Glass cleaner','Mop heads'])[i],case when i=4 then 'ppe' else 'materials' end,case when i=3 then 2 else 25 end,5,'units','London supply cupboard','MOCK-UK-'||i) on conflict do nothing;
  insert into public.messages(id,company_id,sender_id,recipient_id,receiver_id,sender_name,body,created_at) values(md5('cleanma-recording-v1:message:'||i)::uuid,company,case when i%2=0 then cleaner_id else owner_id end,case when i%2=0 then owner_id else cleaner_id end,case when i%2=0 then owner_id else cleaner_id end,case when i%2=0 then 'Sarah Jenkins' else 'Operations Manager' end,(array['Good morning Sarah. Please collect the Baker Street keys from reception.','Keys collected. Starting the office clean now.','Please use the eco-friendly disinfectant in the meeting rooms.','The meeting rooms are complete. Photos will follow.','Tomorrow’s Regent Street rota is ready. Please review your jobs.','Thank you. I can see the assigned jobs and schedule.'])[i],now()-(7-i)*interval '20 minutes') on conflict do nothing;
 end loop;
 insert into public.reports(id,company_id,created_by,title,description) values(md5('cleanma-recording-v1:report')::uuid,company,owner_id,'UK Weekly Operations Summary','[MOCK UK] 12 completed cleanings, 4 cancellations, £5,850 paid revenue and £3,400 monthly payroll. Review attendance and the invoice ledger.') on conflict do nothing;
 perform set_config('request.jwt.claim.sub',cleaner_id::text,true);
 insert into public.incidents(id,company_id,reported_by,type,description,job_id) values(md5('cleanma-recording-v1:incident')::uuid,company,cleaner_id,'Equipment maintenance','[MOCK UK] Vacuum filter needs replacement at the London supply cupboard.',md5('cleanma-recording-v1:job:1')::uuid) on conflict do nothing;
 insert into public.key_registers(id,company_id,customer_id,staff_id,key_code,status,notes) values(md5('cleanma-recording-v1:key')::uuid,company,client_ids[1],staff_ids[1],'MOCK-UK-BAKER','with_office','[MOCK UK] Collect from reception before the scheduled clean.') on conflict do nothing;
 for i in 1..3 loop
  insert into public.employee_titles(id,company_id,title_no,name) select md5('cleanma-recording-v1:title:'||i)::uuid,company,'MOCK-UK-'||i,(array['Senior Cleaner','Cleaner','Field Supervisor'])[i] where not exists(select 1 from public.employee_titles where company_id=company and id=md5('cleanma-recording-v1:title:'||i)::uuid);
  insert into public.employee_groups(id,company_id,name,group_name) select md5('cleanma-recording-v1:group:'||i)::uuid,company,(array['London Commercial','Oxford Residential','Field Supervision'])[i],(array['London Commercial','Oxford Residential','Field Supervision'])[i] where not exists(select 1 from public.employee_groups where company_id=company and id=md5('cleanma-recording-v1:group:'||i)::uuid);
  insert into public.customer_areas(id,company_id,name,main_area) select md5('cleanma-recording-v1:area:'||i)::uuid,company,(array['Central London','West London','Oxford'])[i],i=1 where not exists(select 1 from public.customer_areas where company_id=company and id=md5('cleanma-recording-v1:area:'||i)::uuid);
 end loop;
 insert into public.staff_absences(id,company_id,staff_id,absence_type,start_date,end_date,reason,status) values(md5('cleanma-recording-v1:absence')::uuid,company,staff_ids[3],'folga',day,day,'[MOCK UK] Approved day off','approved') on conflict do nothing;
 -- Populate earlier monthly shifts so payroll totals follow the real hours calculation.
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 for i in 1..3 loop
  remaining:=(array[75,70,25])[i]-private.payroll_hours(company,staff_ids[i],date_trunc('month',day)::date,(date_trunc('month',day)+interval '1 month - 1 day')::date);
  k:=0;
  while remaining>0 loop
   k:=k+1;chunk:=least(8,remaining);
   insert into public.jobs(id,company_id,staff_id,client_id,title,status,scheduled_date,duration_minutes,check_in_at,check_out_at,notes) values(md5('cleanma-recording-v1:payroll-job:'||i||':'||k)::uuid,company,staff_ids[i],client_ids[1],'Monthly contracted cleaning shift','completed',day-8-(k%7)+time '08:00',(chunk*60)::integer,day-8-(k%7)+time '08:00',day-8-(k%7)+time '08:00'+chunk*interval '1 hour','[MOCK UK] Earlier monthly attendance for payroll recording.') on conflict do nothing;
   remaining:=remaining-chunk;
  end loop;
  update public.staff_wages set hourly_rate=20 where id=md5('cleanma-recording-v1:wage:'||i)::uuid and company_id=company;
 end loop;
end;$seed$;
commit;
