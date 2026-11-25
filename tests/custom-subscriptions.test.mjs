import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {Readable} from 'node:stream';
import {selection,checkout,ensureLink,ownerAction,portalChange,syncStripe} from '../server/custom-subscriptions.mjs';
import webhook from '../api/custom-subscriptions-webhook.js';

const company='00000000-0000-4000-8000-000000000001';
const ownerId='00000000-0000-4000-8000-000000000002';
const linkId='00000000-0000-4000-8000-000000000003';
const subscriptionId='00000000-0000-4000-8000-000000000004';
const slug='bright-cleaning-a1b2c3d4';
const ctx={company,user:{id:ownerId}};
const chosen={slug,visits_per_week:3,preferred_days:['Monday','Wednesday','Friday'],start_time:'09:00',
  duration_hours:4,price_per_visit:'25',name:'John Customer',email:'john@example.invalid',
  phone:'07700 900001',address:'1 High Street, London',postcode:'SW1A 1AA'};

function mock(t,logic){
  for(const [key,value] of Object.entries({SUPABASE_URL:'https://database.example.invalid',
    SUPABASE_SERVICE_ROLE_KEY:'test-key',STRIPE_SECRET_KEY:'test-key',
    STRIPE_CUSTOM_WEBHOOK_SECRET:'test-signature'})){
    const previous=process.env[key];process.env[key]=value;
    t.after(()=>{if(previous===undefined)delete process.env[key];else process.env[key]=previous;});
  }
  const calls=[];
  t.mock.method(global,'fetch',async (url,init={})=>{
    const address=String(url);calls.push({url:address,init});
    if(address.includes('/rpc/cleanma_payment_store'))return Response.json({plan:'growth',status:'active',current_period_end:'2099-01-01'});
    if(address.includes('/companies?')&&address.includes('select=status'))return Response.json([{status:'active'}]);
    const data=await logic(address,init,calls);
    if(data===undefined)throw Error('Unexpected URL: '+address);
    return Response.json(data);
  });
  return calls;
}

test('3 weekly visits at £25 produces exactly £300 monthly',()=>{
  const result=selection(chosen);
  assert.equal(result.monthly_amount_pence,30000);
  assert.equal(result.price_per_visit_pence,2500);
  assert.deepEqual(result.preferred_days,['Monday','Wednesday','Friday']);
});

test('days must equal chosen visits; no duplicate day, negative or imprecise prices',()=>{
  for(const update of [
    {preferred_days:['Monday','Wednesday']},
    {preferred_days:['Monday','Monday','Friday']},
    {price_per_visit:'0.05'},
    {price_per_visit:'25.001'},
    {duration_hours:7},
    {start_time:'23:00'},
  ])assert.throws(()=>selection({...chosen,...update}),/INVALID_SELECTION/);
});

test('owner creates a stable company slug, without creating fixed plans',async t=>{
  const calls=mock(t,(url,init)=>{
    if(url.includes('/custom_subscription_links')&&init.method!=='POST')return [];
    if(url.includes('/companies?'))return [{name:'Bright Cleaning Ltd'}];
    if(url.includes('/custom_subscription_links')&&init.method==='POST')return [{...JSON.parse(init.body),id:linkId,enabled:true}];
  });
  const result=await ensureLink(ctx);
  assert.match(result.slug,/^bright-cleaning-ltd-[a-f0-9]{8}$/);
  assert.equal(calls.some(c=>c.url.includes('/subscription_plans')),false);
});

test('Checkout prices inline in GBP and Stripe Connect charges exactly 1%',async t=>{
  const calls=mock(t,(url,init)=>{
    if(url.includes('/custom_subscription_links'))return [{id:linkId,owner_id:ownerId,company_id:company,slug,enabled:true}];
    if(url.includes('/companies?'))return [{id:company,name:'Bright Cleaning',stripe_account_id:'acct_standard'}];
    if(url.endsWith('/account'))return {id:'acct_1T56IvFn9iiryRd5'};
    if(url.endsWith('/accounts/acct_standard'))return {id:'acct_standard',type:'standard',charges_enabled:true,details_submitted:true};
    if(url.includes('/custom_client_subscriptions')&&init.method==='POST')return [JSON.parse(init.body)];
    if(url.includes('/custom_client_subscriptions')&&init.method==='PATCH')return [JSON.parse(init.body)];
    if(url.endsWith('/checkout/sessions'))return {id:'cs_test',url:'https://checkout.stripe.com/example'};
  });
  const result=await checkout({...chosen,monthly_amount_pence:1,price_id:'price_wrong'});
  assert.equal(result.url,'https://checkout.stripe.com/example');
  const saved=calls.find(c=>c.url.includes('/custom_client_subscriptions')&&c.init.method==='POST');
  assert.equal(JSON.parse(saved.init.body).monthly_amount_pence,30000);
  const api=calls.find(c=>c.url.endsWith('/checkout/sessions'));
  assert.equal(api.init.headers['Stripe-Account'],'acct_standard');
  const data=api.init.body;
  assert.equal(data.get('line_items[0][price_data][currency]'),'gbp');
  assert.equal(data.get('line_items[0][price_data][unit_amount]'),'30000');
  assert.equal(data.get('line_items[0][price_data][recurring][interval]'),'month');
  assert.equal(data.get('subscription_data[application_fee_percent]'),'1');
  assert.equal(data.has('line_items[0][price]'),false);
  assert.equal(data.has('payment_method_types[0]'),false);
});

test('checkout cannot proceed without a connected Stripe account',async t=>{
  const calls=mock(t,url=>{
    if(url.includes('/custom_subscription_links'))return [{id:linkId,owner_id:ownerId,company_id:company,slug,enabled:true}];
    if(url.includes('/companies?'))return [{name:'Bright Cleaning',stripe_account_id:null}];
  });
  await assert.rejects(()=>checkout(chosen),/CONNECT_STRIPE_FIRST/);
  assert.equal(calls.some(c=>c.url.includes('api.stripe.com')),false);
});

test('owner skip week touches only the calendar, never Stripe billing',async t=>{
  const calls=mock(t,url=>{
    if(url.includes('/custom_client_subscriptions?'))return [{id:subscriptionId,company_id:company,owner_id:ownerId}];
    if(url.endsWith('/rpc/cleanma_custom_skip'))return {skipped:3};
  });
  assert.deepEqual(await ownerAction(ctx,{subscription_id:subscriptionId,operation:'skip-week'}),{skipped:3});
  const payload=JSON.parse(calls.find(c=>c.url.endsWith('/rpc/cleanma_custom_skip')).init.body);
  assert.equal(payload.target_week,true);
  assert.equal(calls.some(c=>c.url.includes('api.stripe.com')),false);
});

test('client portal updates subscription with a dynamic Price and reschedules with a version guard',async t=>{
  let updated;
  const token='A'.repeat(43);
  const calls=mock(t,(url,init)=>{
    if(url.includes('/custom_subscription_links'))return [{id:linkId,owner_id:ownerId,company_id:company,slug,enabled:true}];
    if(url.includes('/companies?'))return [{name:'Bright Cleaning',stripe_account_id:'acct_standard'}];
    if(url.includes('/custom_subscription_portal_tokens'))return [{subscription_id:subscriptionId}];
    if(url.includes('/custom_client_subscriptions?'))return [{id:subscriptionId,company_id:company,link_id:linkId,
      stripe_subscription_id:'sub_test',stripe_account_id:'acct_standard',status:'active',schedule_version:2}];
    if(url.endsWith('/account'))return {id:'acct_1T56IvFn9iiryRd5'};
    if(url.endsWith('/subscriptions/sub_test')&&init.method==='POST')return {id:'sub_test'};
    if(url.endsWith('/subscriptions/sub_test'))return {id:'sub_test',items:{data:[{id:'si_one',price:{product:'prod_one'}}]}};
    if(url.endsWith('/rpc/cleanma_custom_reconfigure')){updated=JSON.parse(init.body);return {updated:true};}
  });
  const result=await portalChange({...chosen,schedule_version:2},token);
  assert.equal(result.monthly_amount_pence,30000);
  assert.equal(updated.target_month_pence,30000);
  assert.equal(updated.target_version,2);
  const api=calls.find(c=>c.url.endsWith('/subscriptions/sub_test')&&c.init.method==='POST');
  assert.equal(api.init.body.get('items[0][price_data][unit_amount]'),'30000');
  assert.equal(api.init.body.get('items[0][price_data][product]'),'prod_one');
  assert.equal(api.init.body.get('proration_behavior'),'none');
  assert.equal(api.init.headers['Stripe-Account'],'acct_standard');
});

test('signed webhook synchronises the paid subscription; rejects tampered signatures',async t=>{
  let payload;
  mock(t,(url,init)=>{
    if(url.endsWith('/subscriptions/sub_test'))return {id:'sub_test',status:'active',
      metadata:{cleanma_custom_subscription_id:subscriptionId},latest_invoice:'in_paid',items:{data:[{current_period_end:1924992000}]}};
    if(url.endsWith('/invoices/in_paid'))return {status:'paid'};
    if(url.endsWith('/rpc/cleanma_custom_sync_subscription')){payload=JSON.parse(init.body);return {processed:true,status:'pending_approval'};}
  });
  const event={id:'evt_test',account:'acct_standard',type:'checkout.session.completed',
    data:{object:{mode:'subscription',payment_status:'paid',subscription:'sub_test'}}};
  const raw=Buffer.from(JSON.stringify(event));
  const ts=String(Math.floor(Date.now()/1000));
  const signature=createHmac('sha256','test-signature').update(ts+'.').update(raw).digest('hex');
  const req=sig=>Object.assign(Readable.from([raw]),{method:'POST',headers:{'stripe-signature':sig}});
  const res=()=>({statusCode:200,setHeader(){},end(value){this.body=value;}});
  const invalid=res();await webhook(req('t='+ts+',v1=00'),invalid);
  assert.equal(invalid.statusCode,400);
  const valid=res();await webhook(req('t='+ts+',v1='+signature),valid);
  assert.equal(valid.statusCode,200);
  assert.equal(payload.target_subscription,subscriptionId);
  assert.equal(payload.target_account,'acct_standard');
  assert.equal(payload.target_status,'pending_approval');
});

test('current Stripe state maps charge risk events to past_due',async t=>{
  let status;
  mock(t,(url,init)=>{
    if(url.endsWith('/subscriptions/sub_test'))return {id:'sub_test',status:'active',
      metadata:{cleanma_custom_subscription_id:subscriptionId},latest_invoice:'in_paid'};
    if(url.endsWith('/invoices/in_paid'))return {status:'paid'};
    if(url.endsWith('/rpc/cleanma_custom_sync_subscription')){status=JSON.parse(init.body).target_status;return {processed:true};}
  });
  await syncStripe({id:'evt_fraud',account:'acct_standard',type:'charge.dispute.created'},'sub_test');
  assert.equal(status,'past_due');
});
