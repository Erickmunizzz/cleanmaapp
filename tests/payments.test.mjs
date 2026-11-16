import test from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';import {verifySignature,seal,unseal,quickLink,checkout,oauthCallback,expressOnboarding,expressDashboard,connectionStatus,oauthStart} from '../server/payments.mjs';
const context={company:'00000000-0000-4000-8000-000000000001',user:{id:'00000000-0000-4000-8000-000000000002',email:'owner@example.invalid'}};
process.env.PAYMENT_TOKEN_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');process.env.SUPABASE_URL='https://database.example.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';process.env.STRIPE_SECRET_KEY='test-only';
test('webhook accepts signed raw bytes; rejects alteration, replay and bad signatures',()=>{const raw=Buffer.from('{"id":"evt_test"}'),t=String(Math.floor(Date.now()/1000)),sig=createHmac('sha256','test').update(t+'.').update(raw).digest('hex');assert.equal(verifySignature(raw,`t=${t},v1=${sig}`,'test'),true);assert.equal(verifySignature(Buffer.from('{}'),`t=${t},v1=${sig}`,'test'),false);assert.equal(verifySignature(raw,`t=${t},v1=${sig}`,'test',Date.now()+301000),false);assert.equal(verifySignature(raw,'t=1,v1=ff','test'),false)});
test('OAuth token envelope is authenticated encryption',()=>{const token={access_token:'test-token',refresh_token:'test-refresh'};const encrypted=seal(token);assert.equal(encrypted.includes('test-token'),false);assert.deepEqual(unseal(encrypted),token);const corrupted=Buffer.from(encrypted,'base64');corrupted[30]^=1;assert.throws(()=>unseal(corrupted.toString('base64')))});
test('Stripe direct charge routes to connected company and retains 1%, not gross',async()=>{const original=global.fetch;const calls=[];global.fetch=async(url,init)=>{calls.push({url,init});let value;if(url.includes('/rpc/')){const b=JSON.parse(init.body);value=b.action==='subscription'?{plan:'growth',status:'active',current_period_end:'2099-01-01'}:{stripe_account_id:'acct_cleaner'};}else if(url.endsWith('/account'))value={id:'acct_1T56IvFn9iiryRd5'};else if(url.includes('/accounts/'))value={id:'acct_cleaner',type:'express',country:'GB',metadata:{app:'cleanma',company_id:context.company},charges_enabled:true,details_submitted:true};else value={url:'https://checkout.stripe.com/test-only'};return Response.json(value)};try{const result=await quickLink(context,{gateway:'stripe',amount:10000,description:'Office clean',request_id:'00000000-0000-4000-8000-000000000003'});assert.equal(result.application_fee_amount,100);const call=calls.at(-1);assert.equal(call.init.headers['Stripe-Account'],'acct_cleaner');assert.equal(call.init.body.get('payment_intent_data[application_fee_amount]'),'100');assert.equal(call.init.body.get('line_items[0][price_data][currency]'),'gbp');assert.equal(call.init.body.get('line_items[0][price_data][unit_amount]'),'10000');}finally{global.fetch=original}});
test('Starter cannot bypass Growth/Scale gate by calling API logic',async()=>{const original=global.fetch;global.fetch=async()=>Response.json({plan:'starter',status:'active',current_period_end:'2099-01-01'});try{await assert.rejects(()=>quickLink(context,{gateway:'stripe',amount:10000}),/GROWTH_OR_SCALE_REQUIRED/)}finally{global.fetch=original}});
test('subscription price tampering fails before provider access',async()=>{await assert.rejects(()=>checkout(context,{plan:'starter',interval:'month',amount:1}),/INVALID_REQUEST/)});
test('OAuth callback requires matching browser state cookie',async()=>{await assert.rejects(()=>oauthCallback({url:'/api/payment-oauth?state='+ 'a'.repeat(64)+'&code=x',headers:{}},{}),/INVALID_OAUTH_STATE/)});

function expressFetch(options={}) {
 const calls=[];
 const account={id:'acct_cleaner',type:'express',country:'GB',metadata:{app:'cleanma',company_id:context.company},charges_enabled:options.ready??true,details_submitted:options.ready??true,payouts_enabled:options.ready??true};
 return {calls,fetch:async(url,init)=>{
  calls.push({url,init});
  if(url.includes('/rpc/')){
   const {action,payload}=JSON.parse(init.body);
   if(url.endsWith('cleanma_payment_store'))return Response.json(action==='subscription'?{plan:'growth',status:'active',current_period_end:'2099-01-01'}:[]);
   if(action==='begin')return Response.json(options.fresh?{stripe_account_id:null,provision_id:'stable-provision',created_at:options.stale?'2000-01-01':new Date().toISOString()}:{stripe_account_id:account.id});
   if(action==='get')return Response.json({stripe_account_id:account.id});
   if(action==='save'){assert.equal(payload.company,context.company);assert.equal(payload.account_id,account.id);return Response.json({});}
  }
  if(url.endsWith('/account'))return Response.json({id:'acct_1T56IvFn9iiryRd5'});
  if(url.endsWith('/account_links'))return Response.json({url:'https://connect.stripe.com/setup/test-only'});
  if(url.endsWith('/login_links'))return Response.json({url:'https://connect.stripe.com/express/test-only'});
  if(options.failure)return Response.json({}, {status:503});
  return Response.json(options.foreign?{...account,metadata:{app:'cleanma',company_id:'another-company'}}:account);
 }};
}
async function withExpress(options,run){const original=global.fetch;const mock=expressFetch(options);global.fetch=mock.fetch;try{await run(mock.calls)}finally{global.fetch=original}}
test('Express first click creates a GB account with both capabilities and durable idempotency, then saves before onboarding',async()=>{
 delete process.env.STRIPE_CONNECT_CLIENT_ID;delete process.env.PAYMENT_TOKEN_ENCRYPTION_KEY;
 try{await withExpress({fresh:true},async(calls)=>{
  const result=await expressOnboarding(context);assert.match(result.url,/setup/);
  const creation=calls.find(c=>c.url.endsWith('/accounts'));
  assert.equal(creation.init.body.get('type'),'express');assert.equal(creation.init.body.get('country'),'GB');
  assert.equal(creation.init.body.get('capabilities[card_payments][requested]'),'true');assert.equal(creation.init.body.get('capabilities[transfers][requested]'),'true');
  assert.equal(creation.init.headers['Idempotency-Key'],'cleanma-express-stable-provision');
  const save=calls.findIndex(c=>c.url.includes('/rpc/')&&JSON.parse(c.init.body).action==='save');
  const link=calls.findIndex(c=>c.url.endsWith('/account_links'));assert.ok(save<link);
  assert.equal(calls[link].init.body.get('type'),'account_onboarding');
  for(const key of ['return_url','refresh_url']){const u=new URL(calls[link].init.body.get(key));assert.equal(u.origin,'https://cleanmaapp.com');assert.equal(u.pathname,'/admin/settings');assert.equal(u.searchParams.get('finance'),'integrations');}
 })}finally{process.env.PAYMENT_TOKEN_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64')}
});
test('Express retry reuses company account and generates a fresh onboarding link',async()=>withExpress({},async calls=>{await expressOnboarding(context);assert.equal(calls.some(c=>c.url.endsWith('/accounts')),false);assert.ok(calls.some(c=>c.url.endsWith('/account_links')))}));
test('Expired unbound provision stops before creating a second account',async()=>withExpress({fresh:true,stale:true},async calls=>{await assert.rejects(()=>expressOnboarding(context),/STRIPE_SETUP_NEEDS_REVIEW/);assert.equal(calls.some(c=>c.url.endsWith('/accounts')),false)}));
test('Express Dashboard is generated server-side only for ready company account',async()=>withExpress({},async calls=>{await expressDashboard(context);const call=calls.at(-1);assert.equal(call.url,'https://api.stripe.com/v1/accounts/acct_cleaner/login_links');assert.equal(call.init.method,'POST')}));
test('Incomplete or foreign Express accounts cannot open dashboard or collect payments',async()=>{
 await withExpress({ready:false},async calls=>{await assert.rejects(()=>expressDashboard(context),/STRIPE_ACCOUNT_NOT_READY/);assert.equal(calls.some(c=>c.url.endsWith('/login_links')),false)});
 await withExpress({foreign:true},async()=>{await assert.rejects(()=>expressOnboarding(context),/STRIPE_ACCOUNT_MISMATCH/);await assert.rejects(()=>quickLink(context,{gateway:'stripe',amount:10000,description:'Clean',request_id:'00000000-0000-4000-8000-000000000003'}),/STRIPE_ACCOUNT_MISMATCH/)});
});
test('Connection status uses current Stripe flags and does not treat outages as disconnected',async()=>{
 await withExpress({ready:false},async()=>{const rows=await connectionStatus(context);assert.equal(rows[0].connected,true);assert.equal(rows[0].charges_enabled,false);assert.equal(rows[0].details_submitted,false)});
 await withExpress({failure:true},async()=>{const rows=await connectionStatus(context);assert.equal(rows[0].status_unavailable,true);assert.equal(rows[0].charges_enabled,undefined)});
});
test('Stripe cannot enter the retired OAuth authorisation flow',async()=>assert.rejects(()=>oauthStart(context,'stripe',{}),/INVALID_REQUEST/));

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
