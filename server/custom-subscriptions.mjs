import {randomBytes, randomUUID} from 'node:crypto';
import {digest, env, origin, owner, paid, platform, request, stripe} from './payments.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const slugPattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const weekdays=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
export const timeSlots=['08:00','09:00','10:00','11:00','13:00','14:00','15:00','16:00'];
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireUuid(value){if(typeof value!=='string'||!uuid.test(value))throw Error('INVALID_REQUEST');return value;}
function first(rows){return Array.isArray(rows)?rows[0]:null;}
function serviceHeaders(){const key=env('SUPABASE_SERVICE_ROLE_KEY');return {apikey:key,Authorization:'Bearer '+key};}
async function table(name,query={},method='GET',value){
  const url=new URL(env('SUPABASE_URL')+'/rest/v1/'+name);
  Object.entries(query).forEach(([key,entry])=>url.searchParams.set(key,String(entry)));
  return request(url.href,{method,headers:{...serviceHeaders(),...(value===undefined?{}:{'Content-Type':'application/json',Prefer:'return=representation'})},
    ...(value===undefined?{}:{body:JSON.stringify(value)})});
}
function rpc(name,value){return request(env('SUPABASE_URL')+'/rest/v1/rpc/'+name,
  {method:'POST',headers:{...serviceHeaders(),'Content-Type':'application/json'},body:JSON.stringify(value)});}

export function selection(input){
  const visits=Number(input.visits_per_week);
  const days=input.preferred_days;
  const time=input.start_time;
  const duration=Number(input.duration_hours);
  const proposed=String(input.price_per_visit??'').trim();
  if(!Number.isInteger(visits)||visits<1||visits>5||!Array.isArray(days)||days.length!==visits||
    new Set(days).size!==visits||days.some(day=>!weekdays.includes(day))||!timeSlots.includes(time)||
    !Number.isInteger(duration)||duration<2||duration>6||!/^(?:\d{1,4})(?:\.\d{1,2})?$/.test(proposed))throw Error('INVALID_SELECTION');
  const [pounds,pence='']=proposed.split('.');
  const visitPence=Number(pounds)*100+Number(pence.padEnd(2,'0'));
  const monthlyPence=visits*visitPence*4;
  if(visitPence<100||visitPence>1000000||monthlyPence>100000000)throw Error('INVALID_SELECTION');
  return {visits_per_week:visits,preferred_days:weekdays.filter(day=>days.includes(day)),
    start_time:time,duration_hours:duration,price_per_visit_pence:visitPence,monthly_amount_pence:monthlyPence};
}
function contact(input){
  const name=String(input.name??'').trim(),email=String(input.email??'').trim().toLowerCase();
  const phone=String(input.phone??'').trim(),address=String(input.address??'').trim();
  const postcode=String(input.postcode??'').trim().toUpperCase();
  if(name.length<2||name.length>120||!emailPattern.test(email)||email.length>254||
    !/^\+?[0-9()\-\s]{5,30}$/.test(phone)||address.length<6||address.length>240||
    !/^[A-Z0-9][A-Z0-9 ]{3,10}$/.test(postcode))throw Error('INVALID_CUSTOMER');
  return {client_name:name,client_email:email,client_phone:phone,cleaning_address:address,postcode};
}
function validateSlug(value){if(typeof value!=='string'||value.length>110||!slugPattern.test(value))throw Error('LINK_UNAVAILABLE');return value;}
async function linkBySlug(slug){
  const link=first(await table('custom_subscription_links',{select:'id,owner_id,company_id,slug,enabled',slug:'eq.'+validateSlug(slug),enabled:'eq.true',limit:1}));
  if(!link)throw Error('LINK_UNAVAILABLE');
  const company=first(await table('companies',{select:'id,name,stripe_account_id',id:'eq.'+link.company_id,limit:1}));
  if(!company)throw Error('LINK_UNAVAILABLE');
  return {link,company};
}
export async function publicLink(slug){
  const {company}=await linkBySlug(slug);
  return {company_name:company.name,connected:Boolean(company.stripe_account_id)};
}
export async function ownerDashboard(ctx){
  await paid(ctx.company);
  const [link,subscribers,visits]=await Promise.all([
    table('custom_subscription_links',{select:'id,slug,enabled',owner_id:'eq.'+ctx.user.id,company_id:'eq.'+ctx.company,limit:1}),
    table('custom_client_subscriptions',{select:'id,client_name,client_email,visits_per_week,preferred_days,start_time,duration_hours,price_per_visit_pence,monthly_amount_pence,status,owner_approved,next_billing_date,scheduling_error,created_at',owner_id:'eq.'+ctx.user.id,company_id:'eq.'+ctx.company,order:'created_at.desc',limit:100}),
    table('custom_subscription_visits',{select:'id,subscription_id,service_date,status,scheduled_at',owner_id:'eq.'+ctx.user.id,company_id:'eq.'+ctx.company,order:'scheduled_at.asc',limit:600}),
  ]);
  return {link:first(link),subscribers,visits};
}
export async function ensureLink(ctx){
  await paid(ctx.company);
  const existing=first(await table('custom_subscription_links',{select:'id,slug,enabled',company_id:'eq.'+ctx.company,owner_id:'eq.'+ctx.user.id,limit:1}));
  if(existing)return existing;
  const company=first(await table('companies',{select:'name',id:'eq.'+ctx.company,limit:1}));
  if(!company)throw Error('COMPANY_UNAVAILABLE');
  const base=String(company.name||'cleaning-company').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'cleaning-company';
  const slug=base+'-'+randomBytes(4).toString('hex');
  const created=first(await table('custom_subscription_links',{},'POST',
    {company_id:ctx.company,owner_id:ctx.user.id,slug}));
  if(!created)throw Error('LINK_CREATION_FAILED');
  return {id:created.id,slug:created.slug,enabled:created.enabled};
}

export async function checkout(input){
  const {link,company}=await linkBySlug(input.slug);
  const configuration=selection(input),person=contact(input);
  await paid(link.company_id);
  if(!company.stripe_account_id)throw Error('CONNECT_STRIPE_FIRST');
  await platform();
  const account=await stripe('accounts/'+company.stripe_account_id);
  if(account.id!==company.stripe_account_id||account.type!=='standard')throw Error('STRIPE_ACCOUNT_MISMATCH');
  if(!account.charges_enabled||!account.details_submitted)throw Error('STRIPE_ACCOUNT_NOT_READY');
  const id=randomUUID();
  await table('custom_client_subscriptions',{},'POST',{
    id,link_id:link.id,owner_id:link.owner_id,company_id:link.company_id,
    ...configuration,...person,stripe_account_id:company.stripe_account_id,
  });
  const data={mode:'subscription',
    'line_items[0][price_data][currency]':'gbp',
    'line_items[0][price_data][unit_amount]':String(configuration.monthly_amount_pence),
    'line_items[0][price_data][recurring][interval]':'month',
    'line_items[0][price_data][product_data][name]':company.name+' – bespoke cleaning subscription',
    'line_items[0][quantity]':'1',
    'subscription_data[application_fee_percent]':'1',
    'subscription_data[metadata][cleanma_custom_subscription_id]':id,
    'metadata[cleanma_custom_subscription_id]':id,
    client_reference_id:id,customer_email:person.client_email,
    success_url:origin+'/subscribe/'+link.slug+'?checkout=returned',
    cancel_url:origin+'/subscribe/'+link.slug+'?checkout=cancelled',
    integration_identifier:'cleanma_custom_'+Array.from(randomBytes(8),b=>String.fromCharCode(97+b%26)).join(''),
  };
  const session=await stripe('checkout/sessions',data,company.stripe_account_id,'cleanma-custom-checkout-'+id);
  if(!session.id||!session.url)throw Error('CHECKOUT_UNAVAILABLE');
  await table('custom_client_subscriptions',{id:'eq.'+id},'PATCH',{stripe_checkout_session_id:session.id});
  return {url:session.url};
}

async function storedSubscription(id){
  return first(await table('custom_client_subscriptions',{select:'*',id:'eq.'+requireUuid(id),limit:1}));
}
export async function syncStripe(event,subscriptionId){
  if(!/^acct_[a-zA-Z0-9]+$/.test(event.account||'')||!/^sub_[a-zA-Z0-9]+$/.test(subscriptionId||''))throw Error('INVALID_STRIPE_EVENT');
  const sub=await stripe('subscriptions/'+subscriptionId,undefined,event.account);
  const id=sub.metadata?.cleanma_custom_subscription_id;
  if(!uuid.test(id||''))return {ignored:true};
  const invoiceId=typeof sub.latest_invoice==='string'?sub.latest_invoice:null;
  const invoice=invoiceId?await stripe('invoices/'+invoiceId,undefined,event.account):sub.latest_invoice;
  let state='pending_approval';
  if(sub.status==='canceled')state='canceled';
  else if(sub.pause_collection||sub.status==='paused')state='paused';
  else if(['past_due','unpaid','incomplete_expired'].includes(sub.status))state='past_due';
  else if(sub.status!=='active'||invoice?.status!=='paid')state='checkout_pending';
  if(['invoice.payment_failed','invoice.payment_action_required','checkout.session.async_payment_failed'].includes(event.type)&&invoice?.status!=='paid')state='past_due';
  if(['charge.refunded','charge.dispute.created','radar.early_fraud_warning.created'].includes(event.type))state='past_due';
  const end=sub.items?.data?.[0]?.current_period_end??sub.current_period_end;
  const next=Number.isFinite(end)?new Date(end*1000).toISOString().slice(0,10):null;
  return rpc('cleanma_custom_sync_subscription',{target_subscription:id,target_event:event.id,
    target_status:state,target_stripe_subscription:subscriptionId,target_next_billing:next,
    target_account:event.account});
}

async function ownerSubscription(ctx,id){
  const sub=await storedSubscription(id);
  if(!sub||sub.company_id!==ctx.company||sub.owner_id!==ctx.user.id)throw Error('SUBSCRIPTION_UNAVAILABLE');
  return sub;
}
export async function ownerAction(ctx,input){
  await paid(ctx.company);
  const record=await ownerSubscription(ctx,input.subscription_id);
  const action=input.operation;
  if(action==='accept')return rpc('cleanma_custom_accept',{target_subscription:record.id});
  if(action==='skip-next'||action==='skip-week')return rpc('cleanma_custom_skip',{target_subscription:record.id,target_week:action==='skip-week'});
  if(action!=='decline'&&action!=='cancel')throw Error('INVALID_REQUEST');
  if(!record.stripe_subscription_id)throw Error('PAYMENT_NOT_COMPLETED');
  await platform();
  const response=await fetch('https://api.stripe.com/v1/subscriptions/'+encodeURIComponent(record.stripe_subscription_id),{
    method:'DELETE',headers:{Authorization:'Bearer '+env('STRIPE_SECRET_KEY'),
      'Stripe-Account':record.stripe_account_id,'Stripe-Version':'2026-11-18.endive'},signal:AbortSignal.timeout(15000),
  });
  if(!response.ok)throw Error('STRIPE_OPERATION_FAILED');
  return rpc('cleanma_custom_owner_cancel',{target_subscription:record.id,target_declined:action==='decline'});
}

function validEmail(input){const email=String(input||'').trim().toLowerCase();if(email.length>254||!emailPattern.test(email))throw Error('INVALID_EMAIL');return email;}
export async function requestPortal(input){
  const {link}=await linkBySlug(input.slug),email=validEmail(input.email);
  const record=first(await table('custom_client_subscriptions',{
    select:'id,client_name,client_email',company_id:'eq.'+link.company_id,client_email:'eq.'+email,
    status:'in.(active,pending_approval,paused,past_due)',order:'created_at.desc',limit:1,
  }));
  if(!record)return {sent:true}; // Do not reveal client addresses or account existence.
  const from=process.env.CLEANMA_CLIENT_PORTAL_FROM||process.env.CLEANMA_INVITE_FROM;
  if(!process.env.RESEND_API_KEY||!from)throw Error('PORTAL_EMAIL_NOT_CONFIGURED');
  const recent=first(await table('custom_subscription_portal_tokens',{
    select:'created_at',subscription_id:'eq.'+record.id,
    created_at:'gt.'+new Date(Date.now()-120000).toISOString(),limit:1,
  }));
  if(recent)return {sent:true};
  const token=randomBytes(32).toString('base64url');
  await table('custom_subscription_portal_tokens',{},'POST',{
    token_hash:digest(token),subscription_id:record.id,
    expires_at:new Date(Date.now()+30*60000).toISOString(),
  });
  const url=origin+'/subscribe/'+link.slug+'/manage?access='+encodeURIComponent(token);
  await request('https://api.resend.com/emails',{method:'POST',headers:{
    Authorization:'Bearer '+env('RESEND_API_KEY'),'Content-Type':'application/json',
    'Idempotency-Key':'cleanma-portal-'+digest(token).slice(0,24),
  },body:JSON.stringify({from,to:[email],subject:'Your cleaning subscription – secure management link',
    text:'Hello '+record.client_name+',\n\nOpen your secure subscription management link (valid for 30 minutes):\n'+url+
      '\n\nIf you did not ask for this link, you can ignore this message.\n\nCleanMa'})});
  return {sent:true};
}
async function portalSubscription(slug,token){
  if(typeof token!=='string'||!/^[a-zA-Z0-9_-]{43}$/.test(token))throw Error('LINK_EXPIRED');
  const {link}=await linkBySlug(slug);
  const record=first(await table('custom_subscription_portal_tokens',{
    select:'subscription_id',token_hash:'eq.'+digest(token),expires_at:'gt.'+new Date().toISOString(),limit:1,
  }));
  if(!record)throw Error('LINK_EXPIRED');
  const sub=await storedSubscription(record.subscription_id);
  if(!sub||sub.company_id!==link.company_id||sub.link_id!==link.id)throw Error('LINK_EXPIRED');
  return sub;
}
function visibleSubscription(sub){
  const {id,visits_per_week,preferred_days,start_time,duration_hours,price_per_visit_pence,
    monthly_amount_pence,status,next_billing_date,schedule_version}=sub;
  return {id,visits_per_week,preferred_days,start_time,duration_hours,price_per_visit_pence,
    monthly_amount_pence,status,next_billing_date,schedule_version};
}
export async function portalRead(slug,token){
  const sub=await portalSubscription(slug,token);
  const visits=await table('custom_subscription_visits',{select:'service_date,scheduled_at,status',
    subscription_id:'eq.'+sub.id,scheduled_at:'gt.'+new Date().toISOString(),
    status:'in.(scheduled,pending_approval)',order:'scheduled_at.asc',limit:10});
  return {subscription:visibleSubscription(sub),visits};
}
export async function portalChange(input,token){
  const sub=await portalSubscription(input.slug,token);
  if(!['active','pending_approval'].includes(sub.status))throw Error('SUBSCRIPTION_NOT_EDITABLE');
  if(Number(input.schedule_version)!==sub.schedule_version)throw Error('SUBSCRIPTION_CHANGED');
  const update=selection(input);
  if(!sub.stripe_subscription_id)throw Error('PAYMENT_NOT_COMPLETED');
  await platform();
  const current=await stripe('subscriptions/'+sub.stripe_subscription_id,undefined,sub.stripe_account_id);
  const item=current.items?.data?.[0];
  if(!item?.id||!item.price?.product||!/^prod_/.test(item.price.product))throw Error('STRIPE_OPERATION_FAILED');
  await stripe('subscriptions/'+sub.stripe_subscription_id,{
    'items[0][id]':item.id,
    'items[0][price_data][currency]':'gbp',
    'items[0][price_data][unit_amount]':String(update.monthly_amount_pence),
    'items[0][price_data][recurring][interval]':'month',
    'items[0][price_data][product]':item.price.product,
    proration_behavior:'none',
  },sub.stripe_account_id,'cleanma-custom-change-'+sub.id+'-'+sub.schedule_version);
  await rpc('cleanma_custom_reconfigure',{target_subscription:sub.id,target_version:sub.schedule_version,
    target_visits:update.visits_per_week,target_days:update.preferred_days,
    target_time:update.start_time,target_hours:update.duration_hours,
    target_visit_pence:update.price_per_visit_pence,target_month_pence:update.monthly_amount_pence});
  return {updated:true,monthly_amount_pence:update.monthly_amount_pence};
}

export {owner};
