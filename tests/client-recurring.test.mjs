import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {Readable} from 'node:stream';
import {createPlan,customerCheckout,manageSubscription,syncStripeSubscription} from '../server/client-recurring.mjs';
import webhook from '../api/client-subscriptions-webhook.js';

const company='00000000-0000-4000-8000-000000000001';
const ownerId='00000000-0000-4000-8000-000000000002';
const planId='00000000-0000-4000-8000-000000000003';
const subId='00000000-0000-4000-8000-000000000004';
const owner={company,user:{id:ownerId,email:'owner@example.invalid'}};
const plan={id:planId,owner_id:ownerId,company_id:company,name:'Weekly',description:'4 cleans',
  monthly_price:'499.00',cleans_per_month:4,fixed_day:'Monday',fixed_time:'09:00',active:true};

function setup(t,logic){
  for(const [key,value] of Object.entries({
    SUPABASE_URL:'https://database.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-key',
    STRIPE_SECRET_KEY:'test-key',STRIPE_CONNECT_WEBHOOK_SECRET:'signing-test',
  })){
    const previous=process.env[key];process.env[key]=value;
    t.after(()=>{if(previous===undefined)delete process.env[key];else process.env[key]=previous;});
  }
  const calls=[];
  t.mock.method(global,'fetch',async (url,init={})=>{
    const address=String(url);calls.push({url:address,init});
    if(address.includes('/rpc/cleanma_payment_store'))return Response.json({plan:'growth',status:'active',current_period_end:'2099-01-01'});
    if(address.includes('/companies?')&&address.includes('select=status'))return Response.json([{status:'active'}]);
    const result=await logic(address,init,calls);
    if(result===undefined)throw Error('Unexpected request: '+address);
    return Response.json(result);
  });
  return calls;
}

test('owner plan creation validates price, company and weekly frequency',async t=>{
  let created;
  setup(t,(url,init)=>{
    if(url.includes('/subscription_plans')&&init.method==='POST'){
      created=JSON.parse(init.body);return [{...created,id:planId}];
    }
  });
  const result=await createPlan(owner,{name:'Weekly',description:'4 cleans',monthly_price:'499.00',
    cleans_per_month:4,fixed_day:'Monday',fixed_time:'09:00'});
  assert.equal(result.id,planId);
  assert.equal(created.owner_id,ownerId);
  assert.equal(created.company_id,company);
  assert.equal(created.monthly_price,'499.00');
  await assert.rejects(()=>createPlan(owner,{name:'Broken',monthly_price:'0.50',cleans_per_month:4,
    fixed_day:'Monday',fixed_time:'09:00'}),/INVALID_PLAN/);
});

test('customer Checkout takes the stored GBP amount, directs 1% to CleanMa and never trusts a client price',async t=>{
  const calls=setup(t,(url,init)=>{
    if(url.includes('/subscription_plans?'))return [plan];
    if(url.includes('/companies?')&&url.includes('stripe_account_id'))return [{stripe_account_id:'acct_standard'}];
    if(url.endsWith('/account'))return {id:'acct_1T56IvFn9iiryRd5'};
    if(url.endsWith('/accounts/acct_standard'))return {id:'acct_standard',type:'standard',charges_enabled:true,details_submitted:true};
    if(url.includes('/client_subscriptions')&&init.method==='POST')return [JSON.parse(init.body)];
    if(url.includes('/client_subscriptions')&&init.method==='PATCH')return [JSON.parse(init.body)];
    if(url.endsWith('/checkout/sessions'))return {id:'cs_test',url:'https://checkout.stripe.com/example'};
  });
  const result=await customerCheckout({plan_id:planId,name:'Customer Person',email:'client@example.invalid',
    phone:'+44 7212 345678',monthly_price:1});
  assert.equal(result.url,'https://checkout.stripe.com/example');
  const checkout=calls.find(c=>c.url.endsWith('/checkout/sessions'));
  assert.equal(checkout.init.headers['Stripe-Account'],'acct_standard');
  assert.equal(checkout.init.body.get('line_items[0][price_data][unit_amount]'),'49900');
  assert.equal(checkout.init.body.get('subscription_data[application_fee_percent]'),'1');
  assert.equal(checkout.init.body.get('line_items[0][price_data][recurring][interval]'),'month');
  assert.equal(checkout.init.body.has('payment_method_types[0]'),false);
  assert.match(checkout.init.body.get('integration_identifier'),/^cleanma_[a-z]{8}$/);
});

test('public checkout refuses disconnected accounts before touching Stripe',async t=>{
  const calls=setup(t,(url)=>{
    if(url.includes('/subscription_plans?'))return [plan];
    if(url.includes('/companies?')&&url.includes('stripe_account_id'))return [{stripe_account_id:null}];
  });
  await assert.rejects(()=>customerCheckout({plan_id:planId,name:'Customer Person',email:'client@example.invalid',phone:'07700 900000'}),/CONNECT_STRIPE_FIRST/);
  assert.equal(calls.some(c=>c.url.includes('api.stripe.com')),false);
});

test('Skip next clean does not cancel the Stripe subscription or billing',async t=>{
  const calls=setup(t,(url,init)=>{
    if(url.includes('/client_subscriptions?'))return [{id:subId,owner_id:ownerId,company_id:company,status:'active',stripe_subscription_id:'sub_test'}];
    if(url.includes('/companies?')&&url.includes('stripe_account_id'))return [{stripe_account_id:'acct_standard'}];
    if(url.endsWith('/rpc/cleanma_skip_next_client_clean'))return {skipped:true,service_date:'2026-12-07'};
  });
  const result=await manageSubscription(owner,{subscription_id:subId,operation:'skip'});
  assert.equal(result.skipped,true);
  assert.equal(calls.some(c=>c.url.includes('api.stripe.com')),false);
});

test('pausing a client subscription calls Stripe on the originally connected account',async t=>{
  const calls=setup(t,(url,init)=>{
    if(url.includes('/client_subscriptions?'))return [{id:subId,owner_id:ownerId,company_id:company,
      status:'active',stripe_subscription_id:'sub_test',stripe_account_id:'acct_original'}];
    if(url.endsWith('/account'))return {id:'acct_1T56IvFn9iiryRd5'};
    if(url.endsWith('/subscriptions/sub_test')&&init.method==='POST')return {id:'sub_test'};
    if(url.endsWith('/subscriptions/sub_test'))return {id:'sub_test',status:'active',
      pause_collection:{behavior:'void'},latest_invoice:'in_paid',
      metadata:{cleanma_client_subscription_id:subId},items:{data:[{current_period_end:1924992000}]}};
    if(url.endsWith('/invoices/in_paid'))return {status:'paid'};
    if(url.endsWith('/rpc/cleanma_sync_client_subscription'))return {processed:true,status:'paused'};
  });
  const result=await manageSubscription(owner,{subscription_id:subId,operation:'pause'});
  assert.equal(result.status,'paused');
  const update=calls.find(c=>c.url.endsWith('/subscriptions/sub_test')&&c.init.method==='POST');
  assert.equal(update.init.headers['Stripe-Account'],'acct_original');
  assert.equal(update.init.body.get('pause_collection[behavior]'),'void');
});

test('verified connected-account subscription event syncs company-scoped state',async t=>{
  let sync;
  setup(t,(url,init)=>{
    if(url.endsWith('/subscriptions/sub_test'))return {
      id:'sub_test',status:'active',metadata:{cleanma_client_subscription_id:subId},
      latest_invoice:'in_test',items:{data:[{current_period_end:1924992000}]},
    };
    if(url.endsWith('/invoices/in_test'))return {status:'paid'};
    if(url.endsWith('/rpc/cleanma_sync_client_subscription')){sync=JSON.parse(init.body);return {processed:true};}
  });
  await syncStripeSubscription({id:'evt_valid',account:'acct_standard',type:'invoice.paid'},'sub_test');
  assert.equal(sync.target_status,'active');
  assert.equal(sync.target_account,'acct_standard');
  assert.equal(sync.target_subscription,subId);
  assert.equal(sync.target_next_billing,'2031-01-01');
});

test('connected-account webhook verifies the raw Stripe signature before processing',async t=>{
  setup(t,()=>undefined);
  const event={id:'evt_signed',account:'acct_standard',type:'account.updated',data:{object:{}}};
  const raw=Buffer.from(JSON.stringify(event));
  const ts=String(Math.floor(Date.now()/1000));
  const signature=createHmac('sha256','signing-test').update(ts+'.').update(raw).digest('hex');
  function req(sig){return Object.assign(Readable.from([raw]),{method:'POST',headers:{'stripe-signature':sig}});}
  function res(){return {statusCode:200,setHeader(){},end(value){this.body=value;}};}
  const bad=res();await webhook(req('t='+ts+',v1=00'),bad);
  assert.equal(bad.statusCode,400);
  const good=res();await webhook(req('t='+ts+',v1='+signature),good);
  assert.equal(good.statusCode,200);
});
