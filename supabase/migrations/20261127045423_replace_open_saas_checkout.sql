-- Only the checkout reservation path changes. Keep old claims for Stripe events.
do $migration$
declare
  definition text := pg_get_functiondef('public.cleanma_payment_store(text,jsonb)'::regprocedure);
  action_line text := $old$ if action='claim' then$old$;
  action_new text := $new$ if action='latest_checkout_claim' then
  if not exists(select 1 from public.profiles where id=uid and company_id=company and role='owner' and is_active) then raise exception 'OWNER_REQUIRED';end if;
  return (select to_jsonb(c) from private.cleanma_billing_claims c where company_id=company order by created_at desc,id desc limit 1);
 end if;
 if action='claim' then$new$;
  gate_before text := $old$  if claim.id is not null and
     ((claim.created_at>now()-interval '25 hours' and not (coalesce(binding.claim_id=claim.id,false) and binding.status in ('cancelled','inactive')))
       or binding.status='incomplete') then$old$;
  gate_after text := $new$  if payload ? 'replace_claim_id' then
   if (payload->>'replace_claim_id')::uuid is distinct from claim.id then raise exception 'CHECKOUT_RETRY';end if;
   if binding.status='incomplete' then raise exception 'CHECKOUT_PROCESSING';end if;
  elsif claim.id is not null and
     ((claim.created_at>now()-interval '25 hours' and not (coalesce(binding.claim_id=claim.id,false) and binding.status in ('cancelled','inactive')))
       or binding.status='incomplete') then$new$;
begin
  if position(action_line in definition)=0 or position(gate_before in definition)=0 then
    raise exception 'Unexpected checkout lifecycle definition';
  end if;
  execute replace(replace(definition,action_line,action_new),gate_before,gate_after);
end $migration$;
