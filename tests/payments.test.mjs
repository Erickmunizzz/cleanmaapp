import test from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';import {verifySignature,seal,unseal,quickLink,checkout,oauthCallback,stripeOAuthStart,stripeOAuthCallback,oauthStart} from '../server/payments.mjs';
const context={company:'00000000-0000-4000-8000-000000000001',user:{id:'00000000-0000-4000-8000-000000000002',email:'owner@example.invalid'}};
process.env.PAYMENT_TOKEN_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');process.env.SUPABASE_URL='https://database.example.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';process.env.STRIPE_SECRET_KEY='test-only';
test('webhook accepts signed raw bytes; rejects alteration, replay and bad signatures',()=>{const raw=Buffer.from('{"id":"evt_test"}'),t=String(Math.floor(Date.now()/1000)),sig=createHmac('sha256','test').update(t+'.').update(raw).digest('hex');assert.equal(verifySignature(raw,`t=${t},v1=${sig}`,'test'),true);assert.equal(verifySignature(Buffer.from('{}'),`t=${t},v1=${sig}`,'test'),false);assert.equal(verifySignature(raw,`t=${t},v1=${sig}`,'test',Date.now()+301000),false);assert.equal(verifySignature(raw,'t=1,v1=ff','test'),false)});
test('OAuth token envelope is authenticated encryption',()=>{const token={access_token:'test-token',refresh_token:'test-refresh'};const encrypted=seal(token);assert.equal(encrypted.includes('test-token'),false);assert.deepEqual(unseal(encrypted),token);const corrupted=Buffer.from(encrypted,'base64');corrupted[30]^=1;assert.throws(()=>unseal(corrupted.toString('base64')))});
test('Stripe direct charge routes to connected company and retains 1%, not gross',async()=>{const original=global.fetch;const calls=[];global.fetch=async(url,init)=>{calls.push({url,init});let value;if(url.includes('/companies?'))value=[{status:'active'}];else if(url.includes('/rpc/')){const b=JSON.parse(init.body);value=b.action==='subscription'?{plan:'growth',status:'active',current_period_end:'2099-01-01'}:{stripe_account_id:'acct_cleaner'};}else if(url.endsWith('/account'))value={id:'acct_1T56IvFn9iiryRd5'};else if(url.includes('/accounts/'))value={id:'acct_cleaner',type:'standard',charges_enabled:true,details_submitted:true};else value={url:'https://checkout.stripe.com/test-only'};return Response.json(value)};try{const result=await quickLink(context,{gateway:'stripe',amount:10000,description:'Office clean',request_id:'00000000-0000-4000-8000-000000000003'});assert.equal(result.application_fee_amount,100);const call=calls.at(-1);assert.equal(call.init.headers['Stripe-Account'],'acct_cleaner');assert.equal(call.init.body.get('payment_intent_data[application_fee_amount]'),'100');assert.equal(call.init.body.get('line_items[0][price_data][currency]'),'gbp');assert.equal(call.init.body.get('line_items[0][price_data][unit_amount]'),'10000');}finally{global.fetch=original}});
test('Starter cannot bypass Growth/Scale gate by calling API logic',async()=>{const original=global.fetch;global.fetch=async()=>Response.json({plan:'starter',status:'active',current_period_end:'2099-01-01'});try{await assert.rejects(()=>quickLink(context,{gateway:'stripe',amount:10000}),/GROWTH_OR_SCALE_REQUIRED/)}finally{global.fetch=original}});
test('Blocked companies cannot call paid integration APIs with an otherwise valid subscription',async()=>{const original=global.fetch;global.fetch=async(url)=>Response.json(url.includes('/companies?')?[{status:'blocked'}]:{plan:'growth',status:'active',current_period_end:'2099-01-01'});try{await assert.rejects(()=>quickLink(context,{gateway:'stripe',amount:10000}),/GROWTH_OR_SCALE_REQUIRED/)}finally{global.fetch=original}});
test('subscription price tampering fails before provider access',async()=>{await assert.rejects(()=>checkout(context,{plan:'starter',interval:'month',amount:1}),/INVALID_REQUEST/)});
test('OAuth callback requires matching browser state cookie',async()=>{await assert.rejects(()=>oauthCallback({url:'/api/payment-oauth?state='+ 'a'.repeat(64)+'&code=x',headers:{}},{}),/INVALID_OAUTH_STATE/)});

test('Stripe Standard URL uses the configured client and stores an owner-bound state', async t => {
 const original=process.env.STRIPE_CLIENT_ID;
 t.after(()=>{if(original===undefined)delete process.env.STRIPE_CLIENT_ID;else process.env.STRIPE_CLIENT_ID=original;});
 process.env.STRIPE_CLIENT_ID='  ca_ConfiguredClient123  ';
 const calls=[];
 t.mock.method(global,'fetch',async (url,init)=>{
  if(url.includes('/companies?'))return Response.json([{status:'active'}]);
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
  if(url.includes('/companies?'))return Response.json([{status:'active'}]);
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
  if(url.includes('/companies?'))return Response.json([{status:'active'}]);
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
  if(_url.includes('/companies?'))return Response.json([{status:'active'}]);
  const {action}=JSON.parse(init.body);
  return Response.json(action==='subscription'?{plan:'growth',status:'active',current_period_end:'2099-01-01'}:{});
 });
 const {url}=await oauthStart(context,'xero',{setHeader() {}});
 const params=new URL(url).searchParams;
 assert.equal(params.get('scope'),'openid offline_access accounting.invoices.read accounting.contacts.read');
 assert.equal(params.get('redirect_uri'),'https://cleanmaapp.com/api/xero/callback');
});
