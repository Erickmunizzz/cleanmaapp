import test from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';import {verifySignature,seal,unseal,quickLink,checkout,oauthCallback,stripeOAuthStart,stripeOAuthCallback,oauthStart,clientSubscriptionLink} from '../server/payments.mjs';
const context={company:'00000000-0000-4000-8000-000000000001',user:{id:'00000000-0000-4000-8000-000000000002',email:'owner@example.invalid'}};
process.env.PAYMENT_TOKEN_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');process.env.SUPABASE_URL='https://database.example.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';process.env.STRIPE_SECRET_KEY='test-only';
test('webhook accepts signed raw bytes; rejects alteration, replay and bad signatures',()=>{const raw=Buffer.from('{"id":"evt_test"}'),t=String(Math.floor(Date.now()/1000)),sig=createHmac('sha256','test').update(t+'.').update(raw).digest('hex');assert.equal(verifySignature(raw,`t=${t},v1=${sig}`,'test'),true);assert.equal(verifySignature(Buffer.from('{}'),`t=${t},v1=${sig}`,'test'),false);assert.equal(verifySignature(raw,`t=${t},v1=${sig}`,'test',Date.now()+301000),false);assert.equal(verifySignature(raw,'t=1,v1=ff','test'),false)});
test('OAuth token envelope is authenticated encryption',()=>{const token={access_token:'test-token',refresh_token:'test-refresh'};const encrypted=seal(token);assert.equal(encrypted.includes('test-token'),false);assert.deepEqual(unseal(encrypted),token);const corrupted=Buffer.from(encrypted,'base64');corrupted[30]^=1;assert.throws(()=>unseal(corrupted.toString('base64')))});
test('Stripe direct charge routes to connected company and retains 1%, not gross',async()=>{const original=global.fetch;const calls=[];global.fetch=async(url,init)=>{calls.push({url,init});let value;if(url.includes('/rpc/')){const b=JSON.parse(init.body);value=b.action==='subscription'?{plan:'growth',status:'active',current_period_end:'2099-01-01'}:{stripe_account_id:'acct_cleaner'};}else if(url.endsWith('/account'))value={id:'acct_1T56IvFn9iiryRd5'};else if(url.includes('/accounts/'))value={id:'acct_cleaner',type:'standard',charges_enabled:true,details_submitted:true};else value={url:'https://checkout.stripe.com/test-only'};return Response.json(value)};try{const result=await quickLink(context,{gateway:'stripe',amount:10000,description:'Office clean',request_id:'00000000-0000-4000-8000-000000000003'});assert.equal(result.application_fee_amount,100);const call=calls.at(-1);assert.equal(call.init.headers['Stripe-Account'],'acct_cleaner');assert.equal(call.init.body.get('payment_intent_data[application_fee_amount]'),'100');assert.equal(call.init.body.get('billing_address_collection'),'required');assert.equal(call.init.body.get('line_items[0][price_data][currency]'),'gbp');assert.equal(call.init.body.get('line_items[0][price_data][unit_amount]'),'10000');}finally{global.fetch=original}});
test('Starter cannot bypass Growth/Scale gate by calling API logic',async()=>{const original=global.fetch;global.fetch=async()=>Response.json({plan:'starter',status:'active',current_period_end:'2099-01-01'});try{await assert.rejects(()=>quickLink(context,{gateway:'stripe',amount:10000}),/GROWTH_OR_SCALE_REQUIRED/)}finally{global.fetch=original}});
test('subscription price tampering fails before provider access',async()=>{await assert.rejects(()=>checkout(context,{plan:'starter',interval:'month',amount:1}),/INVALID_REQUEST/)});
test('OAuth callback requires matching browser state cookie',async()=>{await assert.rejects(()=>oauthCallback({url:'/api/payment-oauth?state='+ 'a'.repeat(64)+'&code=x',headers:{}},{}),/INVALID_OAUTH_STATE/)});

test('Stripe Standard URL uses the configured client and stores an owner-bound state', async t => {
 const original=process.env.STRIPE_CLIENT_ID;
 t.after(()=>{if(original===undefined)delete process.env.STRIPE_CLIENT_ID;else process.env.STRIPE_CLIENT_ID=original;});
 process.env.STRIPE_CLIENT_ID='  ca_ConfiguredClient123  ';
 const calls=[];
 t.mock.method(global,'fetch',async (url,init)=>{
  if(url.endsWith('/account'))return Response.json({id:'acct_1T56IvFn9iiryRd5'});
  const rpc=JSON.parse(init.body);
  calls.push(rpc);
  return Response.json(rpc.action==='subscription'?{plan:'growth',status:'active',current_period_end:null}:{});
 });
 const headers={};
 const {url}=await stripeOAuthStart(context,{setHeader:(name,value)=>{headers[name]=value;}});
 const consent=new URL(url);
 assert.equal(consent.origin+consent.pathname,'https://connect.stripe.com/oauth/authorize');
 assert.equal(consent.searchParams.get('client_id'),'ca_ConfiguredClient123');
 assert.equal(consent.searchParams.get('scope'),'read_write');
 assert.equal(consent.searchParams.get('redirect_uri'),'https://cleanmaapp.com/api/stripe/connect/callback');
 assert.match(headers['Set-Cookie'],new RegExp('^cleanma_stripe_oauth='+consent.searchParams.get('state')));
 assert.equal(calls[1].payload.company,context.company);
 assert.equal(calls[1].payload.user,context.user.id);
 assert.equal(calls[1].payload.provider,'stripe');
});

test('Stripe rejects missing or malformed Client IDs before contacting Stripe', async t => {
 const originals={STRIPE_CLIENT_ID:process.env.STRIPE_CLIENT_ID,NEXT_PUBLIC_STRIPE_CLIENT_ID:process.env.NEXT_PUBLIC_STRIPE_CLIENT_ID};
 t.after(()=>{for(const [key,value] of Object.entries(originals)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 delete process.env.NEXT_PUBLIC_STRIPE_CLIENT_ID;
 const log=t.mock.method(console,'error',()=>{});
 t.mock.method(global,'fetch',async url=>{
  assert.ok(url.endsWith('/cleanma_payment_store'));
  return Response.json({plan:'growth',status:'active',current_period_end:null});
 });
 process.env.STRIPE_CLIENT_ID='  ';
 await assert.rejects(()=>stripeOAuthStart(context,{}),/STRIPE_CLIENT_ID_MISSING/);
 process.env.STRIPE_CLIENT_ID='not-a-connect-id';
 await assert.rejects(()=>stripeOAuthStart(context,{}),/STRIPE_CLIENT_ID_INVALID/);
 assert.equal(log.mock.callCount(),2);
});

test('Stripe callback exchanges the code once and binds the Standard account to the stored owner', async t => {
 const state='a'.repeat(64);
 const req={url:'/api/stripe/connect/callback?code=ac_once&state='+state,headers:{cookie:'cleanma_stripe_oauth='+state}};
 let consumed=false;
 const writes=[];
 t.mock.method(global,'fetch',async (url,init)=>{
  if(url.endsWith('/account'))return Response.json({id:'acct_1T56IvFn9iiryRd5'});
  if(url.endsWith('/oauth/token')){
   assert.equal(init.body.get('code'),'ac_once');
   assert.equal(init.body.get('grant_type'),'authorization_code');
   return Response.json({stripe_user_id:'acct_standard',scope:'read_write',livemode:false});
  }
  if(url.endsWith('/accounts/acct_standard'))return Response.json({id:'acct_standard',type:'standard'});
  const body=JSON.parse(init.body);
  if(body.action==='consume_state'){
   if(consumed)return Response.json(null);
   consumed=true;
   return Response.json({provider:'stripe',company_id:context.company,user_id:context.user.id});
  }
  if(body.action==='subscription')return Response.json({plan:'growth',status:'active',current_period_end:null});
  assert.ok(url.endsWith('/cleanma_bind_stripe_standard'));
  writes.push(body);
  return Response.json({});
 });
 await assert.rejects(()=>stripeOAuthCallback({...req,headers:{}},{setHeader(){}}),/INVALID_OAUTH_STATE/);
 await stripeOAuthCallback(req,{setHeader(){}});
 await assert.rejects(()=>stripeOAuthCallback(req,{setHeader(){}}),/INVALID_OAUTH_STATE/);
 assert.deepEqual(writes,[{target_company:context.company,owner_id:context.user.id,account_id:'acct_standard'}]);
});

test('integration gate follows server-managed active and trial entitlements without false date or casing blocks',async()=>{
 const {hasIntegrationAccess}=await import('../server/payments.mjs');
 const now=Date.parse('2026-11-15T12:00:00Z');
 for(const plan of ['growth','scale',' GROWTH ',' Scale ']){
  assert.equal(hasIntegrationAccess({plan,status:'ACTIVE',current_period_end:null},now),true);
  assert.equal(hasIntegrationAccess({plan,status:'active',current_period_end:'2026-12-01'},now),true);
  assert.equal(hasIntegrationAccess({plan,status:'active',current_period_end:'2026-11-01'},now),false);
  assert.equal(hasIntegrationAccess({plan,status:'active',current_period_end:'invalid'},now),false);
  for(const status of ['past_due','cancelled','inactive'])assert.equal(hasIntegrationAccess({plan,status,current_period_end:null},now),false);
 }
 assert.equal(hasIntegrationAccess({plan:'growth',status:'trialing',trial_ends_at:'2026-12-01'},now),true);
 assert.equal(hasIntegrationAccess({plan:'growth',status:'trialing',trial_ends_at:'2026-11-01'},now),false);
 assert.equal(hasIntegrationAccess({plan:'starter',status:'active',current_period_end:null},now),false);
 assert.equal(hasIntegrationAccess(null,now),false);
});

test('Xero callback saves both encrypted tokens for the owner who started consent', async t => {
  const state = 'a'.repeat(64);
  const callback = 'https://cleanmaapp.com/api/xero/callback';
  const tokens = {access_token: 'test-access', refresh_token: 'test-refresh'};
  let saved;
  t.mock.method(global, 'fetch', async (url, init) => {
    if (url.endsWith('/connect/token')) {
      assert.equal(init.body.get('redirect_uri'), callback);
      assert.equal(init.body.get('code'), 'test-code');
      return Response.json(tokens);
    }
    if (url.endsWith('/connections')) return Response.json([{tenantId: 'test-tenant'}]);
    const {action, payload} = JSON.parse(init.body);
    if (action === 'consume_state') return Response.json({provider: 'xero', company_id: context.company, user_id: context.user.id});
    assert.equal(action, 'save_connection');
    saved = payload;
    return Response.json({});
  });
  process.env.XERO_CLIENT_ID = 'test-client';
  process.env.XERO_CLIENT_SECRET = 'test-secret';
  const res = {setHeader() {}, end() {}};
  await oauthCallback({url: callback + '?code=test-code&state=' + state, headers: {cookie: 'cleanma_oauth=' + state}}, res);
  assert.equal(res.statusCode, 303);
  assert.equal(saved.company, context.company);
  assert.equal(saved.user, context.user.id);
  assert.equal(saved.account_id, 'test-tenant');
  const credentials = unseal(saved.ciphertext);
  assert.equal(credentials.access_token, tokens.access_token);
  assert.equal(credentials.refresh_token, tokens.refresh_token);
});

test('Xero consent uses granular read scopes and requests a refresh token', async t => {
 process.env.XERO_CLIENT_ID='test-client';
 process.env.XERO_CLIENT_SECRET='test-secret';
 t.mock.method(global,'fetch',async (_url,init)=>{
  const {action}=JSON.parse(init.body);
  return Response.json(action==='subscription'?{plan:'growth',status:'active',current_period_end:'2099-01-01'}:{});
 });
 const {url}=await oauthStart(context,'xero',{setHeader() {}});
 const params=new URL(url).searchParams;
 assert.equal(params.get('scope'),'openid offline_access accounting.invoices.read accounting.contacts.read');
 assert.equal(params.get('redirect_uri'),'https://cleanmaapp.com/api/xero/callback');
});

const subscriptionInput = {
 action:'client-subscription-link', interval:'month', amount:12500, description:' Office cleaning ',
 client_id:'00000000-0000-4000-8000-000000000003', request_id:'00000000-0000-4000-8000-000000000004',
};
function withSubscriptions(t, enabled=true) {
 const prior=process.env.CLEANMA_CLIENT_SUBSCRIPTIONS_ENABLED;
 t.after(()=>{if(prior===undefined)delete process.env.CLEANMA_CLIENT_SUBSCRIPTIONS_ENABLED;else process.env.CLEANMA_CLIENT_SUBSCRIPTIONS_ENABLED=prior;});
 if(enabled)process.env.CLEANMA_CLIENT_SUBSCRIPTIONS_ENABLED='true';else delete process.env.CLEANMA_CLIENT_SUBSCRIPTIONS_ENABLED;
}

test('new recurring charges are disabled by default, without calling Stripe or Supabase', async t=>{
 withSubscriptions(t,false);
 const fetch=t.mock.method(global,'fetch',async()=>{throw Error('Unexpected network');});
 await assert.rejects(()=>clientSubscriptionLink(context,subscriptionInput),/CLIENT_SUBSCRIPTIONS_DISABLED/);
 assert.equal(fetch.mock.callCount(),0);
});

test('recurring Checkout uses connected merchant, 1% invoice fee, customer billing address and stable idempotency', async t=>{
 withSubscriptions(t);
 const sessions=[];
 t.mock.method(global,'fetch',async(url,init)=>{
  const parsed=new URL(url);
  if(parsed.pathname.endsWith('/cleanma_payment_store'))return Response.json({plan:'growth',status:'active',current_period_end:null});
  if(parsed.pathname.endsWith('/clients')){
   assert.equal(parsed.searchParams.get('company_id'),'eq.'+context.company);
   assert.equal(parsed.searchParams.get('is_archived'),'eq.false');
   assert.equal(parsed.searchParams.get('id'),'eq.'+subscriptionInput.client_id);
   return Response.json([{id:subscriptionInput.client_id}]);
  }
  if(parsed.pathname.endsWith('/cleanma_stripe_express_store'))return Response.json({stripe_account_id:'acct_merchant'});
  if(parsed.pathname.endsWith('/account'))return Response.json({id:'acct_1T56IvFn9iiryRd5'});
  if(parsed.pathname.endsWith('/accounts/acct_merchant'))return Response.json({id:'acct_merchant',type:'standard',charges_enabled:true,details_submitted:true,capabilities:{card_payments:'active'}});
  assert.equal(parsed.href,'https://api.stripe.com/v1/checkout/sessions');
  sessions.push(init);
  return Response.json({url:'https://checkout.stripe.com/test-only'});
 });
 assert.equal((await clientSubscriptionLink(context,subscriptionInput)).url,'https://checkout.stripe.com/test-only');
 await clientSubscriptionLink(context,subscriptionInput);
 assert.equal(sessions[0].headers['Idempotency-Key'],sessions[1].headers['Idempotency-Key']);
 assert.equal(sessions[0].headers['Idempotency-Key'],'cleanma-client-sub-'+context.company+'-'+subscriptionInput.request_id);
 assert.equal(sessions[0].headers['Stripe-Account'],'acct_merchant');
 const body=sessions[0].body;
 assert.equal(body.get('mode'),'subscription');
 assert.equal(body.get('billing_address_collection'),'required');
 assert.equal(body.get('line_items[0][price_data][unit_amount]'),'12500');
 assert.equal(body.get('line_items[0][price_data][currency]'),'gbp');
 assert.equal(body.get('line_items[0][price_data][recurring][interval]'),'month');
 assert.equal(body.get('line_items[0][price_data][product_data][name]'),'Office cleaning');
 assert.equal(body.get('subscription_data[application_fee_percent]'),'1');
 assert.equal(body.get('subscription_data[metadata][company_id]'),context.company);
 assert.equal(body.get('subscription_data[metadata][client_id]'),subscriptionInput.client_id);
 assert.equal(body.get('customer_email'),null);
 assert.equal(body.get('payment_intent_data[application_fee_amount]'),null);
 assert.equal(body.get('success_url'),'https://cleanmaapp.com/client-payment-result?status=returned');
});

test('client subscription rejects fee override, unknown intervals, invalid amount and clients outside the workspace', async t=>{
 withSubscriptions(t);
 const fetch=t.mock.method(global,'fetch',async(url)=>{
  if(url.endsWith('/cleanma_payment_store'))return Response.json({plan:'growth',status:'active',current_period_end:null});
  if(url.includes('/clients?'))return Response.json([]);
  throw Error('Must not reach Stripe');
 });
 for(const changes of [{fee:0},{interval:'week'},{amount:99},{amount:100000001},{client_id:'acct_merchant'},{description:''}]) {
  await assert.rejects(()=>clientSubscriptionLink(context,{...subscriptionInput,...changes}),/INVALID_REQUEST/);
 }
 assert.equal(fetch.mock.callCount(),0);
 await assert.rejects(()=>clientSubscriptionLink(context,subscriptionInput),/CLIENT_NOT_AVAILABLE/);
 assert.equal(fetch.mock.callCount(),2);
});

test('client recurring requires owner, approved origin and active card capability', async t=>{
 withSubscriptions(t);
 const handler=(await import('../api/payments.js')).default;
 process.env.SUPABASE_ANON_KEY='test-anon-only';
 t.after(()=>{delete process.env.SUPABASE_ANON_KEY;});
 let role='cleaner';
 t.mock.method(global,'fetch',async(url)=>{
  const pathname=new URL(url).pathname;
  if(pathname.endsWith('/auth/v1/user'))return Response.json(context.user);
  if(pathname.endsWith('/profiles'))return Response.json([{id:context.user.id,company_id:context.company,is_active:true,role}]);
  if(pathname.endsWith('/cleanma_payment_store'))return Response.json({plan:'growth',status:'active',current_period_end:null});
  if(pathname.endsWith('/clients'))return Response.json([{id:subscriptionInput.client_id}]);
  if(pathname.endsWith('/account'))return Response.json({id:'acct_1T56IvFn9iiryRd5'});
  if(pathname.endsWith('/cleanma_stripe_express_store'))return Response.json({stripe_account_id:'acct_merchant'});
  if(pathname.endsWith('/accounts/acct_merchant'))return Response.json({id:'acct_merchant',type:'standard',charges_enabled:true,details_submitted:true,capabilities:{card_payments:'pending'}});
  throw Error('Must not create a Checkout Session');
 });
 async function send(origin,body=subscriptionInput){
  const res={setHeader(){},end(raw){this.body=JSON.parse(raw);}};
  await handler({method:'POST',body,headers:{origin,authorization:'Bearer test-token'}},res);
  return [res.statusCode,res.body];
 }
 assert.deepEqual(await send('https://example.invalid'),[403,{error:'Origin not allowed'}]);
 assert.deepEqual(await send('https://cleanmaapp.com'),[400,{error:'OWNER_REQUIRED'}]);
 role='owner';
 assert.deepEqual(await send('https://cleanmaapp.com',{action:'client-subscription-options'}),[200,{enabled:true}]);
 assert.deepEqual(await send('https://cleanmaapp.com'),[400,{error:'STRIPE_ACCOUNT_NOT_READY'}]);
});

test('SaaS Checkout charges the platform in GBP and leaves payment methods to the Dashboard', async t => {
 const calls=[];
 t.mock.method(global,'fetch',async(url,init)=>{
  calls.push({url,init});
  if(url.endsWith('/account'))return Response.json({id:'acct_1T56IvFn9iiryRd5'});
  if(url.endsWith('/prices/price_1UbwGeFn9iiryRd5uB6PCo8F'))return Response.json({active:true,currency:'gbp',unit_amount:185750,recurring:{interval:'year',interval_count:1}});
  if(url.endsWith('/cleanma_payment_store')) {
   const {action}=JSON.parse(init.body);
   return Response.json(action==='binding'?null:{id:'11111111-1111-4111-8111-111111111111'});
  }
  assert.ok(url.endsWith('/checkout/sessions'));
  return Response.json({url:'https://checkout.stripe.com/test-only'});
 });
 assert.deepEqual(await checkout(context,{plan:'growth',interval:'year'}),{url:'https://checkout.stripe.com/test-only'});
 const call=calls.at(-1).init;
 assert.equal(call.headers['Stripe-Account'],undefined);
 assert.equal(call.body.get('mode'),'subscription');
 assert.equal(call.body.get('currency'),'gbp');
 assert.equal(call.body.get('line_items[0][price]'),'price_1UbwGeFn9iiryRd5uB6PCo8F');
 assert.equal(call.body.get('subscription_data[application_fee_percent]'),null);
 assert.equal(call.body.get('payment_method_types[0]'),null);
});

test('past-due SaaS subscription opens the existing platform Customer Portal without a new Checkout', async t => {
 const before=process.env.STRIPE_BILLING_PORTAL_CONFIG;
 process.env.STRIPE_BILLING_PORTAL_CONFIG='bpc_test';
 t.after(()=>{if(before===undefined)delete process.env.STRIPE_BILLING_PORTAL_CONFIG;else process.env.STRIPE_BILLING_PORTAL_CONFIG=before;});
 t.mock.method(global,'fetch',async(url,init)=>{
  if(url.endsWith('/account'))return Response.json({id:'acct_1T56IvFn9iiryRd5'});
  if(url.endsWith('/cleanma_payment_store')) {
   assert.equal(JSON.parse(init.body).action,'binding');
   return Response.json({status:'past_due',customer_id:'cus_retry'});
  }
  assert.ok(url.endsWith('/billing_portal/sessions'));
  assert.equal(init.headers['Stripe-Account'],undefined);
  assert.equal(init.body.get('customer'),'cus_retry');
  assert.equal(init.body.get('configuration'),'bpc_test');
  assert.equal(init.body.get('return_url'),'https://cleanmaapp.com/planos');
  return Response.json({url:'https://billing.stripe.com/test-only'});
 });
 assert.deepEqual(await checkout(context,{plan:'starter',interval:'month'}),{url:'https://billing.stripe.com/test-only'});
});

test('SaaS signed webhooks reconcile payment, renewal, failure, terminal and retry statuses', async t => {
 const {default:handler}=await import('../api/stripe-webhook.js');
 const before=process.env.STRIPE_WEBHOOK_SECRET;
 process.env.STRIPE_WEBHOOK_SECRET='webhook-test-only';
 t.after(()=>{if(before===undefined)delete process.env.STRIPE_WEBHOOK_SECRET;else process.env.STRIPE_WEBHOOK_SECRET=before;});
 const writes=[];
 let period=1796100000;
 let subscriptionStatus='incomplete';
 let invoiceStatus='open';
 let lastInvoice='in_latest';
 let attempt=0;
 let rejectStore=false;
 t.mock.method(global,'fetch',async(url,init)=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/subscriptions/sub_saas')){
   assert.equal(new URL(url).searchParams.get('expand[]'),'latest_invoice');
   return Response.json({
    id:'sub_saas',customer:{id:'cus_1'},status:subscriptionStatus,latest_invoice:{id:lastInvoice,status:invoiceStatus},
    cancel_at_period_end:subscriptionStatus==='active',
    metadata:{claim_id:'11111111-1111-4111-8111-111111111111',company_id:context.company},
    items:{data:[{quantity:1,current_period_end:period,price:{
     id:'price_1UbwFxFn9iiryRd5VAqtdCnN',currency:'gbp',unit_amount:8999,recurring:{interval:'month',interval_count:1},
    }}]},
   });
  }
  assert.ok(path.endsWith('/cleanma_payment_store'));
  const body=JSON.parse(init.body);
  assert.equal(body.action,'apply_subscription');
  if(rejectStore)return Response.json({}, {status:503});
  writes.push(body.payload);
  return Response.json({});
 });
 async function send(type,object,options={}) {
  const created=Math.floor(Date.now()/1000);
  const raw=Buffer.from(JSON.stringify({id:'evt_'+(++attempt),created,type,data:{object},...options}));
  const signature=createHmac('sha256','webhook-test-only').update(created+'.').update(raw).digest('hex');
  const req={method:'POST',headers:{'stripe-signature':`t=${created},v1=${signature}`},async *[Symbol.asyncIterator](){yield raw;}};
  const res={setHeader(){},end(value){this.result=JSON.parse(value);}};
  await handler(req,res);
  return res;
 }
 assert.equal((await send('checkout.session.completed',{mode:'subscription',subscription:'sub_saas'})).statusCode,200);
 assert.equal(writes.at(-1).status,'incomplete');
 assert.equal(writes.at(-1).price_id,'price_1UbwFxFn9iiryRd5VAqtdCnN');
 subscriptionStatus='active';invoiceStatus='paid';
 const invoice={id:'in_latest',parent:{subscription_details:{subscription:{id:'sub_saas'}}}};
 assert.equal((await send('invoice.paid',invoice)).statusCode,200);
 assert.equal(writes.at(-1).status,'active');
 assert.equal(writes.at(-1).period_end,new Date(period*1000).toISOString());

 // Active, with period-end cancellation scheduled, still retains the paid period.
 await send('customer.subscription.updated',{id:'sub_saas'});
 assert.equal(writes.at(-1).status,'active');
 period+=30*86400;
 lastInvoice='in_renewal';
 await send('invoice.paid',{...invoice,id:lastInvoice});
 assert.equal(writes.at(-1).period_end,new Date(period*1000).toISOString());

 // An out-of-order failure for a prior invoice cannot revoke a newer paid invoice.
 await send('invoice.payment_failed',invoice);
 assert.equal(writes.at(-1).status,'active');
 invoiceStatus='open';subscriptionStatus='past_due';
 await send('invoice.payment_failed',{...invoice,id:lastInvoice});
 assert.equal(writes.at(-1).status,'past_due');
 subscriptionStatus='unpaid';
 await send('customer.subscription.updated',{id:'sub_saas'});
 assert.equal(writes.at(-1).status,'past_due');
 subscriptionStatus='active';invoiceStatus='paid';
 await send('invoice.paid',{...invoice,id:lastInvoice});
 assert.equal(writes.at(-1).status,'active');
 subscriptionStatus='canceled';period=null;
 await send('customer.subscription.deleted',{id:'sub_saas'});
 assert.equal(writes.at(-1).status,'cancelled');
 assert.equal(writes.at(-1).period_end,null);
 const writeCount=writes.length;
 await send('invoice.paid',{id:'in_standalone'});
 await send('invoice.paid',invoice,{account:'acct_connected'});
 assert.equal(writes.length,writeCount);
 rejectStore=true;
 t.mock.method(console,'error',()=>{});
 assert.equal((await send('customer.subscription.deleted',{id:'sub_saas'})).statusCode,503);
});

test('expired Stripe Connect callback offers retry on the canonical admin settings route without leaking the code', async () => {
 const {default:callback}=await import('../api/stripe/connect/callback.js');
 const headers={};
 const res={setHeader(name,value){headers[name]=value;},end(){}};
 await callback({method:'GET',headers:{},url:'/api/stripe/connect/callback?code=private-code&state='+'a'.repeat(64)},res);
 assert.equal(res.statusCode,303);
 assert.equal(headers.Location,'https://cleanmaapp.com/admin/settings?finance=integrations&integration=stripe_expired');
 assert.equal(headers['Cache-Control'],'no-store');
});

test('resume Checkout is read-only and finds only an open platform SaaS session for this requester', async t => {
 const {resumeCheckout}=await import('../server/payments.mjs');
 const claim='11111111-1111-4111-8111-111111111111';
 const metadata={claim_id:claim,company_id:context.company,user_id:context.user.id,plan_tier:'scale'};
 const expiration=Math.floor(Date.now()/1000)+3600;
 const expected='https://checkout.stripe.com/g/pay/cs_test_resume#original';
 const own={id:'cs_test_resume',object:'checkout.session',mode:'subscription',status:'open',payment_status:'unpaid',
  client_reference_id:claim,expires_at:expiration,url:expected,metadata};
 let pages=0;
 t.mock.method(global,'fetch',async (url,init)=>{
  if(url.endsWith('/account'))return Response.json({id:'acct_1T56IvFn9iiryRd5'});
  if(url.endsWith('/cleanma_payment_store')){
   assert.deepEqual(JSON.parse(init.body),{action:'binding',payload:{company:context.company}});
   return Response.json(null);
  }
  const u=new URL(url);
  assert.equal(u.hostname,'api.stripe.com');assert.equal(u.pathname,'/v1/checkout/sessions');
  assert.equal(init.method,undefined);assert.equal(init.headers['Stripe-Account'],undefined);
  assert.equal(init.headers['Idempotency-Key'],undefined);
  assert.equal(u.searchParams.get('status'),'open');
  assert.ok(Number(u.searchParams.get('created[gte]')) > 0);
  pages++;
  if(pages===1){
   assert.equal(u.searchParams.get('starting_after'),null);
   return Response.json({has_more:true,data:[
    {...own,id:'cs_wrong_tenant',metadata:{...metadata,company_id:'some-other-tenant'}},
    {...own,id:'cs_wrong_user',metadata:{...metadata,user_id:'another-workspace-owner'}},
    {...own,id:'cs_wrong_claim',client_reference_id:'different-claim'},
    {...own,id:'cs_expired',expires_at:expiration-7200},
    {...own,id:'cs_completed',status:'complete'},
    {...own,id:'cs_wrong_mode',mode:'payment'},
    {...own,id:'cs_invalid_url',url:'https://checkout.stripe.com.invalid/c/pay/cs_x'},
    {...own,id:'cs_test_cursor',url:null},
   ]});
  }
  assert.equal(u.searchParams.get('starting_after'),'cs_test_cursor');
  return Response.json({has_more:false,data:[own]});
 });
 assert.deepEqual(await resumeCheckout(context),{url:expected});
 assert.equal(pages,2);
});

test('resume Checkout never creates a session when none is open or when the owner already has Billing', async t => {
 const {resumeCheckout}=await import('../server/payments.mjs');
 let binding=null;
 let searches=0;
 t.mock.method(global,'fetch',async (url,init)=>{
  if(url.endsWith('/account'))return Response.json({id:'acct_1T56IvFn9iiryRd5'});
  if(url.endsWith('/cleanma_payment_store'))return Response.json(binding);
  assert.match(url,/\/checkout\/sessions\?/);
  assert.equal(init.method,undefined);
  searches++;
  return Response.json({has_more:false,data:[]});
 });
 await assert.rejects(()=>resumeCheckout(context),/CHECKOUT_NOT_OPEN/);
 binding={status:'past_due'};
 await assert.rejects(()=>resumeCheckout(context),/CHECKOUT_NOT_OPEN/);
 assert.equal(searches,1);
});

test('resume Checkout route keeps the owner and canonical origin checks and does not trust caller selectors',async t=>{
 const {default:handler}=await import('../api/payments.js');
 const previous=process.env.SUPABASE_ANON_KEY;
 process.env.SUPABASE_ANON_KEY='test-anon';
 t.after(()=>{if(previous===undefined)delete process.env.SUPABASE_ANON_KEY;else process.env.SUPABASE_ANON_KEY=previous;});
 let selected;
 t.mock.method(global,'fetch',async (url,init)=>{
  if(url.endsWith('/auth/v1/user'))return Response.json(context.user);
  if(url.includes('/rest/v1/profiles?'))return Response.json([{id:context.user.id,company_id:context.company,role:'owner',is_active:true}]);
  if(url.endsWith('/account'))return Response.json({id:'acct_1T56IvFn9iiryRd5'});
  if(url.endsWith('/cleanma_payment_store')){selected=JSON.parse(init.body).payload.company;return Response.json(null);}
  assert.match(url,/\/checkout\/sessions\?/);
  return Response.json({has_more:false,data:[]});
 });
 async function send(origin,authorization){
  const res={setHeader(){},end(value){this.result=JSON.parse(value);}};
  await handler({method:'POST',headers:{origin,authorization},body:{action:'resume-checkout',company_id:'injected',user_id:'injected'}},res);
  return res;
 }
 assert.equal((await send('https://untrusted.invalid','Bearer token')).statusCode,403);
 assert.deepEqual((await send('https://cleanmaapp.com',undefined)).result,{error:'UNAUTHORISED'});
 assert.deepEqual((await send('https://cleanmaapp.com','Bearer token')).result,{error:'CHECKOUT_NOT_OPEN'});
 assert.equal(selected,context.company);
});
