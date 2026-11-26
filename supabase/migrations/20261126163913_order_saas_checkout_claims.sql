-- A database transaction can create two successive claims at the same now()
-- timestamp. Advance the per-company sequence under the existing advisory lock,
-- including when requests began before they acquired that lock.
do $migration$
declare
  definition text := pg_get_functiondef('public.cleanma_payment_store(text,jsonb)'::regprocedure);
  old_fragment text := $old$insert into private.cleanma_billing_claims(company_id,user_id,plan,interval,price)
    values(company,uid,payload->>'plan',payload->>'interval',payload->>'price') returning * into claim;$old$;
  new_fragment text := $new$insert into private.cleanma_billing_claims(company_id,user_id,plan,interval,price,created_at)
    values(company,uid,payload->>'plan',payload->>'interval',payload->>'price',
      greatest(clock_timestamp(),coalesce(claim.created_at+interval '1 microsecond','-infinity'::timestamptz)))
    returning * into claim;$new$;
begin
  if position(old_fragment in definition)=0 then
    raise exception 'Unexpected lifecycle definition; apply the preceding billing migration first';
  end if;
  execute replace(definition, old_fragment, new_fragment);
end $migration$;
