import {randomBytes,randomUUID} from 'node:crypto';
import {env,origin,owner,paid,platform,stripe,request} from './payments.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const weekdays=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const timePattern=/^([01]\d|2[0-3]):[0-5]\d$/;
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function serviceHeaders(){const token=env('SUPABASE_SERVICE_ROLE_KEY');return {apikey:token,Authorization:'Bearer '+token};}
async function table(name,query={},method='GET',value){
  const url=new URL(env('SUPABASE_URL')+'/rest/v1/'+name);
  for(const [k,v] of Object.entries(query))url.searchParams.set(k,String(v));
  const headers={...serviceHeaders(),...(value===undefined?{}:{'Content-Type':'application/json',Prefer:'return=representation'})};
  return request(url.href,{method,headers,...(value===undefined?{}:{body:JSON.stringify(value)})});
}
export async function rpc(name,parameters){
  return request(env('SUPABASE_URL')+'/rest/v1/rpc/'+name,{
    method:'POST',headers:{...serviceHeaders(),'Content-Type':'application/json'},body:JSON.stringify(parameters),
  });
}
function first(rows){return Array.isArray(rows)?rows[0]:null;}
function requireUuid(value){if(typeof value!=='string'||!uuid.test(value))throw Error('INVALID_REQUEST');return value;}
function planFields(value){
  const name=String(value.name??'').trim();
  const description=String(value.description??'').trim();
  const price=String(value.monthly_price??'').trim();
  const cleans=Number(value.cleans_per_month);
  const day=value.fixed_day,time=value.fixed_time;
  if(name.length<2||name.length>100||description.length>500||
     !/^\d{1,6}(\.\d{1,2})?$/.test(price)||Number(price)<1||
     !Number.isInteger(cleans)||cleans<1||cleans>8||!weekdays.includes(day)||!timePattern.test(time))
     throw Error('INVALID_PLAN');
  return {name,description,monthly_price:Number(price).toFixed(2),cleans_per_month:cleans,
    fixed_day:day,fixed_time:time,active:true};
}

export async function publicPlan(planId){
  const id=requireUuid(planId);
  const plan=first(await table('subscription_plans',{
    select:'id,name,description,monthly_price,cleans_per_month,fixed_day,fixed_time,owner_id,company_id',
    id:'eq.'+id,active:'eq.true',limit:1,
  }));
  if(!plan)throw Error('PLAN_UNAVAILABLE');
  const company=first(await table('companies',{select:'name,stripe_account_id',id:'eq.'+plan.company_id,limit:1}));
  if(!company)throw Error('PLAN_UNAVAILABLE');
  const {owner_id,company_id,...details}=plan;
  return {plan:{...details,company_name:company.name},connected:Boolean(company.stripe_account_id)};
}

export async function ownerList(ctx){
  await paid(ctx.company);
  const [plans,subscribers,alerts,cleans]=await Promise.all([
    table('subscription_plans',{select:'id,name,description,monthly_price,cleans_per_month,fixed_day,fixed_time,active,created_at',owner_id:'eq.'+ctx.user.id,company_id:'eq.'+ctx.company,order:'created_at.desc',limit:100}),
    table('client_subscriptions',{select:'id,plan_id,client_name,client_email,client_phone,status,next_billing_date,created_at,stripe_subscription_id,checkout_pending',owner_id:'eq.'+ctx.user.id,company_id:'eq.'+ctx.company,order:'created_at.desc',limit:100}),
    table('client_subscription_alerts',{select:'id,subscription_id,message,created_at',owner_id:'eq.'+ctx.user.id,order:'created_at.desc',limit:20}),
    table('client_subscription_cleans',{select:'id,subscription_id,service_date,status',owner_id:'eq.'+ctx.user.id,order:'service_date.asc',limit:500}),
  ]);
  return {plans,subscribers,alerts,cleans};
}

export async function createPlan(ctx,input){
  await paid(ctx.company);
  const value=planFields(input);
  const created=first(await table('subscription_plans',{},'POST',{owner_id:ctx.user.id,company_id:ctx.company,...value}));
  if(!created)throw Error('PLAN_SAVE_FAILED');
  return {id:created.id};
}

export async function updatePlan(ctx,input){
  await paid(ctx.company);
  const id=requireUuid(input.plan_id);
  if(typeof input.active!=='boolean')throw Error('INVALID_REQUEST');
  const changed=await table('subscription_plans',{id:'eq.'+id,owner_id:'eq.'+ctx.user.id,company_id:'eq.'+ctx.company},'PATCH',{active:input.active});
  if(!changed.length)throw Error('PLAN_UNAVAILABLE');
  return {updated:true};
}

export async function customerCheckout(input){
  const planId=requireUuid(input.plan_id);
  const name=String(input.name??'').trim();
  const email=String(input.email??'').trim().toLowerCase();
  const phone=String(input.phone??'').trim();
  if(name.length<2||name.length>120||!emailPattern.test(email)||email.length>254||
     phone.length<5||phone.length>30||!/^\+?[0-9()\-\s]{5,30}$/.test(phone))throw Error('INVALID_CUSTOMER');
  const plan=first(await table('subscription_plans',{
    select:'*',id:'eq.'+planId,active:'eq.true',limit:1,
  }));
  if(!plan)throw Error('PLAN_UNAVAILABLE');
  await paid(plan.company_id);
  const company=first(await table('companies',{select:'stripe_account_id',id:'eq.'+plan.company_id,limit:1}));
  if(!company?.stripe_account_id)throw Error('CONNECT_STRIPE_FIRST');
  await platform();
  const account=await stripe('accounts/'+company.stripe_account_id);
  if(account.id!==company.stripe_account_id||account.type!=='standard')throw Error('STRIPE_ACCOUNT_MISMATCH');
  if(!account.charges_enabled||!account.details_submitted)throw Error('STRIPE_ACCOUNT_NOT_READY');
  const amount=Math.round(Number(plan.monthly_price)*100);
  if(amount<100||amount>100000000)throw Error('INVALID_PLAN');
  const id=randomUUID();
  await table('client_subscriptions',{},'POST',{
    id,plan_id:plan.id,owner_id:plan.owner_id,company_id:plan.company_id,
    client_name:name,client_email:email,client_phone:phone,
    stripe_account_id:company.stripe_account_id,
    fixed_day:plan.fixed_day,fixed_time:plan.fixed_time,status:'paused',checkout_pending:true,
  });
  const data={
    mode:'subscription',
    'line_items[0][price_data][currency]':'gbp',
    'line_items[0][price_data][unit_amount]':String(amount),
    'line_items[0][price_data][recurring][interval]':'month',
    'line_items[0][price_data][product_data][name]':plan.name,
    'line_items[0][quantity]':'1',
    'subscription_data[application_fee_percent]':'1',
    'subscription_data[metadata][cleanma_client_subscription_id]':id,
    'metadata[cleanma_client_subscription_id]':id,
    client_reference_id:id,
    customer_email:email,
    'phone_number_collection[enabled]':'true',
    success_url:origin+'/subscribe/'+plan.id+'?checkout=returned',
    cancel_url:origin+'/subscribe/'+plan.id+'?checkout=cancelled',
    integration_identifier:'cleanma_'+Array.from(randomBytes(8),b=>String.fromCharCode(97+b%26)).join(''),
  };
  const session=await stripe('checkout/sessions',data,company.stripe_account_id,'cleanma-client-'+id);
  if(!session.url||!session.id)throw Error('CHECKOUT_UNAVAILABLE');
  await table('client_subscriptions',{id:'eq.'+id},'PATCH',{stripe_checkout_session_id:session.id});
  return {url:session.url};
}

async function connectedSubscription(ctx,id){
  const row=first(await table('client_subscriptions',{
    select:'id,owner_id,company_id,status,stripe_subscription_id,stripe_account_id',id:'eq.'+requireUuid(id),
    owner_id:'eq.'+ctx.user.id,company_id:'eq.'+ctx.company,limit:1,
  }));
  if(!row)throw Error('SUBSCRIPTION_UNAVAILABLE');
  return {...row,account:row.stripe_account_id};
}

export async function manageSubscription(ctx,input){
  await paid(ctx.company);
  const action=input.operation;
  if(!['skip','pause','resume','cancel'].includes(action))throw Error('INVALID_REQUEST');
  const record=await connectedSubscription(ctx,input.subscription_id);
  if(action==='skip')return rpc('cleanma_skip_next_client_clean',{target_subscription:record.id});
  if(!record.stripe_subscription_id)throw Error('PAYMENT_NOT_COMPLETED');
  await platform();
  const account=record.account,id=record.stripe_subscription_id;
  if(action==='cancel'){
    const response=await fetch('https://api.stripe.com/v1/subscriptions/'+encodeURIComponent(id),{
      method:'DELETE',headers:{Authorization:'Bearer '+env('STRIPE_SECRET_KEY'),
        'Stripe-Account':account,'Stripe-Version':'2026-11-18.endive'},signal:AbortSignal.timeout(15000),
    });
    if(!response.ok)throw Error('STRIPE_OPERATION_FAILED');
  }else{
    const parameters=action==='pause'?{'pause_collection[behavior]':'void'}:{pause_collection:''};
    await stripe('subscriptions/'+id,parameters,account,'cleanma-client-'+action+'-'+randomUUID());
  }
  const result=await syncStripeSubscription({
    id:'owner-'+action+'-'+randomUUID(),account,type:'customer.subscription.updated',
  },id);
  return {updated:true,status:result.status};
}

export async function syncStripeSubscription(event,subscriptionId){
  const account=event.account;
  if(!/^acct_[A-Za-z0-9]+$/.test(account||'')||!/^sub_[A-Za-z0-9]+$/.test(subscriptionId||''))
    throw Error('INVALID_STRIPE_EVENT');
  const sub=await stripe('subscriptions/'+subscriptionId,undefined,account);
  const id=sub.metadata?.cleanma_client_subscription_id;
  if(!uuid.test(id||''))return {ignored:true};
  const invoiceId=typeof sub.latest_invoice==='string'?sub.latest_invoice:null;
  const invoice=invoiceId?await stripe('invoices/'+invoiceId,undefined,account):sub.latest_invoice;
  const lastInvoicePaid=invoice?.status==='paid';
  let status='paused';
  if(sub.status==='canceled')status='canceled';
  else if(sub.pause_collection||sub.status==='paused')status='paused';
  else if(sub.status==='past_due'||sub.status==='unpaid')status='past_due';
  else if(sub.status==='active'&&lastInvoicePaid)status='active';
  if(event.type==='invoice.payment_failed'&&invoice?.status!=='paid')status='past_due';
  if(event.type==='invoice.payment_action_required'&&invoice?.status!=='paid')status='past_due';
  if(event.type==='checkout.session.async_payment_failed')status='past_due';
  if(['charge.refunded','charge.dispute.created','radar.early_fraud_warning.created'].includes(event.type))status='past_due';
  const end=sub.items?.data?.[0]?.current_period_end??sub.current_period_end;
  const date=Number.isFinite(end)?new Date(end*1000).toISOString().slice(0,10):null;
  return rpc('cleanma_sync_client_subscription',{
    target_subscription:id,target_event:event.id,target_status:status,
    target_stripe_subscription:sub.id,target_next_billing:date,target_account:account,
  });
}

export {owner};
