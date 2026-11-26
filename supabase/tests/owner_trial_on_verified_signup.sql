begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  cleaner_id uuid := gen_random_uuid();
  invited_id uuid := gen_random_uuid();
  target uuid;
  owner_email text := owner_id || '@example.invalid';
  cleaner_email text := cleaner_id || '@example.invalid';
  invited_email text := invited_id || '@example.invalid';
  chosen jsonb := '{"cleanma_owner_signup":{"version":1,"plan":"starter","interval":"year"}}';
  sub public.subscriptions;
  verified_at timestamptz;
begin
  insert into auth.users (id,email,raw_app_meta_data,raw_user_meta_data)
    values(owner_id,owner_email,'{"provider":"email"}',chosen);
  if exists(select 1 from public.profiles where id=owner_id) then
    raise exception 'Workspace created before email confirmation';
  end if;
  update auth.users set email_confirmed_at=clock_timestamp() where id=owner_id returning email_confirmed_at into verified_at;
  select p.company_id into strict target from public.profiles p where p.id=owner_id and p.role='owner' and p.is_active;
  select s.* into strict sub from public.subscriptions s where s.company_id=target;
  if sub.plan<>'growth' or sub.status<>'trialing' or sub.trial_started_at<verified_at
     or extract(epoch from sub.trial_ends_at-sub.trial_started_at)<>1209600
  then raise exception 'Expected exactly 336 hours of Growth access starting at verification'; end if;
  if (select raw_user_meta_data from auth.users where id=owner_id) is distinct from chosen
  then raise exception 'Stored billing preference changed'; end if;
  update auth.users set email_confirmed_at=clock_timestamp() where id=owner_id;
  if (select p.company_id from public.profiles p where p.id=owner_id)<>target
  then raise exception 'Confirmation was not idempotent'; end if;

  insert into public.staff_invites(company_id,email,created_by)
    values (target,invited_email,owner_id);
  insert into auth.users (id,email,raw_app_meta_data,raw_user_meta_data,email_confirmed_at)
    values (invited_id,invited_email,'{"provider":"email"}',chosen,clock_timestamp());
  if exists(select 1 from public.profiles where id=invited_id)
  then raise exception 'Reserved employee email incorrectly provisioned as owner'; end if;

  insert into auth.users (id,email,raw_app_meta_data,raw_user_meta_data,email_confirmed_at)
    values (cleaner_id,cleaner_email,'{"provider":"email"}','{}',clock_timestamp());
  if exists(select 1 from public.profiles where id=cleaner_id)
  then raise exception 'Generic Auth identity incorrectly provisioned as owner'; end if;
  insert into public.profiles(id,company_id,role,full_name) values (cleaner_id,target,'cleaner','Rollback cleaner');
  insert into public.staff(company_id,profile_id,name,email) values (target,cleaner_id,'Rollback cleaner',cleaner_email);
  perform set_config('request.jwt.claim.sub', cleaner_id::text, true);
  if not private.is_company_cleaner(target) then raise exception 'Active trial Cleaner is blocked'; end if;
  update public.subscriptions set trial_started_at=now()-interval '14 days',trial_ends_at=now() where company_id=target;
  if private.is_company_cleaner(target) or (public.current_subscription_access()->>'active')::boolean
  then raise exception 'Cleaner not suspended exactly at expiration'; end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  if (public.current_subscription_access()->>'active')::boolean
  then raise exception 'Owner not identified as expired'; end if;
  update public.subscriptions set status='active', plan='starter',current_period_end=now()+interval '30 days' where company_id=target;
  if not (public.current_subscription_access()->>'active')::boolean
  then raise exception 'Owner access not restored'; end if;
  perform set_config('request.jwt.claim.sub', cleaner_id::text, true);
  if not private.is_company_cleaner(target) then raise exception 'Cleaner access not restored'; end if;
  if not exists(select 1 from public.staff where profile_id=cleaner_id and company_id=target)
  then raise exception 'Employee data was not preserved'; end if;
end $$;
rollback;
