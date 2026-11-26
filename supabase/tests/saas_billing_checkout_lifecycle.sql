begin;
do $$
declare
 owner_id uuid := gen_random_uuid();
 target uuid;
 first_claim uuid;
 second_claim uuid;
 actual public.subscriptions;
 initial public.subscriptions;
 subscription_base jsonb;
 evt_base text := 'evt_fixture_' || replace(gen_random_uuid()::text,'-','');
 observed timestamptz := clock_timestamp();
 paid_end timestamptz := clock_timestamp() + interval '30 days';
 renewed_end timestamptz := clock_timestamp() + interval '60 days';
begin
 insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,email_confirmed_at)
 values(owner_id,owner_id||'@example.invalid','{"provider":"email"}','{"cleanma_owner_signup":{"version":1,"plan":"starter","interval":"month"}}',clock_timestamp());
 select company_id into strict target from public.profiles where id=owner_id and role='owner' and is_active;
 select s.* into strict initial from public.subscriptions s where s.company_id=target;

 first_claim:=(public.cleanma_payment_store('claim',jsonb_build_object(
  'company',target,'user',owner_id,'plan','starter','interval','month','price','price_fixture_starter'
 ))->>'id')::uuid;
 subscription_base:=jsonb_build_object('claim_id',first_claim,'company_id',target,
  'subscription_id','sub_fixture_first_'||owner_id,'customer_id','cus_fixture_'||owner_id,
  'plan','starter','price_id','price_fixture_starter','event_created',100,'period_end',paid_end);

 perform public.cleanma_payment_store('apply_subscription',subscription_base||jsonb_build_object(
  'event_id',evt_base||'_incomplete','status','incomplete','observed_at',observed+'1 second'::interval));
 perform public.cleanma_payment_store('apply_subscription',subscription_base||jsonb_build_object(
  'event_id',evt_base||'_first_failed','status','past_due','observed_at',observed+'2 seconds'::interval));
 select s.* into strict actual from public.subscriptions s where s.company_id=target;
 if actual is distinct from initial then raise exception 'Unpaid first Checkout changed the Growth trial'; end if;

 perform public.cleanma_payment_store('apply_subscription',subscription_base||jsonb_build_object(
  'event_id',evt_base||'_first_paid','status','active','observed_at',observed+'3 seconds'::interval));
 if not exists (select 1 from public.subscriptions where company_id=target and plan='starter' and status='active' and current_period_end=paid_end)
 then raise exception 'Initial payment did not activate paid plan'; end if;

 perform public.cleanma_payment_store('apply_subscription',subscription_base||jsonb_build_object(
  'event_id',evt_base||'_first_paid','status','past_due','observed_at',observed+'4 seconds'::interval));
 if not exists (select 1 from public.subscriptions where company_id=target and status='active')
 then raise exception 'Duplicate event reverted paid plan'; end if;

 perform public.cleanma_payment_store('apply_subscription',subscription_base||jsonb_build_object(
  'event_id',evt_base||'_renewal_paid','status','active','period_end',renewed_end,'observed_at',observed+'5 seconds'::interval));
 if not exists (select 1 from public.subscriptions where company_id=target and status='active' and current_period_end=renewed_end)
 then raise exception 'Renewal did not extend paid period'; end if;

 perform public.cleanma_payment_store('apply_subscription',subscription_base||jsonb_build_object(
  'event_id',evt_base||'_stale','status','past_due','observed_at',observed+'4 seconds'::interval));
 if not exists (select 1 from public.subscriptions where company_id=target and status='active' and current_period_end=renewed_end)
 then raise exception 'A stale snapshot changed paid access'; end if;

 perform public.cleanma_payment_store('apply_subscription',subscription_base||jsonb_build_object(
  'event_id',evt_base||'_renewal_failed','status','past_due','period_end',renewed_end,'observed_at',observed+'6 seconds'::interval));
 if not exists (select 1 from public.subscriptions where company_id=target and status='past_due')
 then raise exception 'Failed renewal did not suspend'; end if;

 perform public.cleanma_payment_store('apply_subscription',subscription_base||jsonb_build_object(
  'event_id',evt_base||'_recovered','status','active','period_end',renewed_end,'observed_at',observed+'7 seconds'::interval));
 if not exists (select 1 from public.subscriptions where company_id=target and status='active')
 then raise exception 'Recovered payment did not restore'; end if;

 perform public.cleanma_payment_store('apply_subscription',subscription_base||jsonb_build_object(
  'event_id',evt_base||'_ended','status','cancelled','period_end',null,'observed_at',observed+'8 seconds'::interval));
 if not exists (select 1 from public.subscriptions where company_id=target and status='cancelled')
 then raise exception 'Final cancellation did not suspend'; end if;
 second_claim:=(public.cleanma_payment_store('claim',jsonb_build_object(
  'company',target,'user',owner_id,'plan','scale','interval','year','price','price_fixture_scale'
 ))->>'id')::uuid;
 if second_claim is null or second_claim=first_claim then raise exception 'Cancelled Checkout was reused'; end if;

 perform public.cleanma_payment_store('apply_subscription',subscription_base||jsonb_build_object(
  'claim_id',second_claim,'subscription_id','sub_fixture_second_'||owner_id,'plan','scale','price_id','price_fixture_scale',
  'event_id',evt_base||'_resubscribed','status','active','event_created',101,'observed_at',observed+'9 seconds'::interval));
 perform public.cleanma_payment_store('apply_subscription',subscription_base||jsonb_build_object(
  'event_id',evt_base||'_old_ended','status','cancelled','event_created',102,'observed_at',observed+'10 seconds'::interval));
 if not exists(select 1 from public.subscriptions where company_id=target and plan='scale' and status='active')
 then raise exception 'Old cancellation overwrote the replacement subscription'; end if;
 if not exists(select 1 from public.profiles where id=owner_id and company_id=target and is_active)
 then raise exception 'Subscription lifecycle removed the owner profile'; end if;
end $$;
rollback;
