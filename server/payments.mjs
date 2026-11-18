import {randomBytes,createHash,createCipheriv,createDecipheriv,createHmac,timingSafeEqual} from 'node:crypto';
export const origin='https://cleanmaapp.com';
export const catalog={starter:{month:['price_1UbwFxFn9iiryRd5VAqtdCnN',8999],year:['price_1UbwGYFn9iiryRd5fnYR3I2t',92870]},growth:{month:['price_1UbwGHFn9iiryRd5nOnv4epK',17999],year:['price_1UbwGeFn9iiryRd5uB6PCo8F',185750]},scale:{month:['price_1UbwGNFn9iiryRd530SxIUHd',29999],year:['price_1UbwGmFn9iiryRd5VlPYJsdq',309590]}};
export function env(k){const v=process.env[k];if(!v)throw new Error('CONFIGURATION_REQUIRED');return v;}
export async function request(url,init={}){const r=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(15000)});const body=await r.json();if(!r.ok)throw new Error('PROVIDER_REQUEST_FAILED');return body;}
export function db(action,payload={}){return request(env('SUPABASE_URL')+'/rest/v1/rpc/cleanma_payment_store',{method:'POST',headers:{apikey:env('SUPABASE_SERVICE_ROLE_KEY'),Authorization:'Bearer '+env('SUPABASE_SERVICE_ROLE_KEY'),'Content-Type':'application/json'},body:JSON.stringify({action,payload})});}
export async function owner(req){const token=req.headers.authorization;if(!/^Bearer [\w.-]+$/.test(token||''))throw new Error('UNAUTHORISED');const headers={apikey:env('SUPABASE_ANON_KEY'),Authorization:token};const user=await request(env('SUPABASE_URL')+'/auth/v1/user',{headers});const rows=await request(env('SUPABASE_URL')+'/rest/v1/profiles?select=id,company_id,role,is_active&id=eq.'+encodeURIComponent(user.id),{headers});const profile=rows[0];if(!profile||profile.role!=='owner'||!profile.is_active||!profile.company_id)throw new Error('OWNER_REQUIRED');return {user,company:profile.company_id};}
export async function stripe(path,data,account,idempotency){const headers={Authorization:'Bearer '+env('STRIPE_SECRET_KEY'),'Stripe-Version':'2026-08-26.dahlia'};if(account)headers['Stripe-Account']=account;if(idempotency)headers['Idempotency-Key']=idempotency;let init={headers};if(data){headers['Content-Type']='application/x-www-form-urlencoded';init={method:'POST',headers,body:new URLSearchParams(data)};}return request('https://api.stripe.com/v1/'+path,init);}
export async function platform(){const a=await stripe('account');if(a.id!==(process.env.STRIPE_PLATFORM_ACCOUNT_ID||'acct_1T56IvFn9iiryRd5'))throw new Error('WRONG_PLATFORM_ACCOUNT');return a;}
export function seal(data){const key=Buffer.from(env('PAYMENT_TOKEN_ENCRYPTION_KEY'),'base64');if(key.length!==32)throw new Error('CONFIGURATION_REQUIRED');const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');}
export function unseal(s){const bytes=Buffer.from(s,'base64'),dec=createDecipheriv('aes-256-gcm',Buffer.from(env('PAYMENT_TOKEN_ENCRYPTION_KEY'),'base64'),bytes.subarray(0,12));dec.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([dec.update(bytes.subarray(28)),dec.final()]).toString());}
export const digest=s=>createHash('sha256').update(s).digest('hex');
export function json(res,status,data){res.setHeader('Cache-Control','no-store');res.statusCode=status;res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(data));}
export async function body(req){if(req.body&&typeof req.body==='object'&&!Buffer.isBuffer(req.body)){if(Buffer.byteLength(JSON.stringify(req.body))>4096)throw new Error('INVALID_REQUEST');return req.body;}let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)throw new Error('INVALID_REQUEST');}return JSON.parse(raw||req.body||'{}');}
export function hasIntegrationAccess(subscription, now=Date.now()) {
 if(!subscription)return false;
 const plan=String(subscription.plan??'').trim().toLowerCase();
 const status=String(subscription.status??'').trim().toLowerCase();
 if(!['growth','scale'].includes(plan))return false;
 if(status==='active')return subscription.current_period_end===null || (Number.isFinite(Date.parse(subscription.current_period_end)) && Date.parse(subscription.current_period_end)>now);
 return status==='trialing' && plan==='growth' && Number.isFinite(Date.parse(subscription.trial_ends_at)) && Date.parse(subscription.trial_ends_at)>now;
}
export async function paid(company){const subscription=await db('subscription',{company});if(!hasIntegrationAccess(subscription))throw new Error('GROWTH_OR_SCALE_REQUIRED');}
export async function checkout(ctx,input){const price=catalog[input.plan]?.[input.interval];if(!price||['amount','price','price_id','currency','company_id','user_id'].some(k=>k in input))throw new Error('INVALID_REQUEST');await platform();const p=await stripe('prices/'+price[0]);if(!p.active||p.currency!=='gbp'||p.unit_amount!==price[1]||p.recurring?.interval!==input.interval||p.recurring?.interval_count!==1)throw new Error('INVALID_PRICE');const existing=await db('binding',{company:ctx.company});if(existing&&['active','past_due'].includes(existing.status)){if(!process.env.STRIPE_BILLING_PORTAL_CONFIG)throw new Error('CONFIGURATION_REQUIRED');return {url:(await stripe('billing_portal/sessions',{customer:existing.customer_id,return_url:origin+'/planos',...(process.env.STRIPE_BILLING_PORTAL_CONFIG?{configuration:process.env.STRIPE_BILLING_PORTAL_CONFIG}:{})})).url};}const claim=await db('claim',{company:ctx.company,user:ctx.user.id,plan:input.plan,interval:input.interval,price:price[0]});
const metadata={user_id:ctx.user.id,company_id:ctx.company,email:ctx.user.email,plan_tier:input.plan,claim_id:claim.id};const data={mode:'subscription',currency:'gbp','line_items[0][price]':price[0],'line_items[0][quantity]':'1',customer_email:ctx.user.email,client_reference_id:claim.id,success_url:origin+'/planos?checkout=returned',cancel_url:origin+'/planos',};for(const [k,v]of Object.entries(metadata)){data[`metadata[${k}]`]=v;data[`subscription_data[metadata][${k}]`]=v;}const session=await stripe('checkout/sessions',data,undefined,'cleanma-sub-'+claim.id);return {url:session.url};}
export async function quickLink(ctx,input){await paid(ctx.company);if(input.gateway!=='stripe')throw new Error('GATEWAY_NOT_CONFIGURED');if(!Number.isInteger(input.amount)||input.amount<100||input.amount>100000000||typeof input.description!=='string'||!input.description.trim()||input.description.length>200||!/^[0-9a-f-]{36}$/i.test(input.request_id||''))throw new Error('INVALID_REQUEST');await platform();const connection=await expressStore('get',ctx);if(!connection?.stripe_account_id)throw new Error('CONNECT_STRIPE_FIRST');const account=await stripe('accounts/'+connection.stripe_account_id);assertConnectedAccount(account,ctx);if(!account.charges_enabled||!account.details_submitted)throw new Error('STRIPE_ACCOUNT_NOT_READY');const fee=Math.round(input.amount/100);const session=await stripe('checkout/sessions',{mode:'payment',currency:'gbp','payment_method_types[0]':'card','line_items[0][price_data][currency]':'gbp','line_items[0][price_data][unit_amount]':String(input.amount),'line_items[0][price_data][product_data][name]':input.description.trim(),'line_items[0][quantity]':'1','payment_intent_data[application_fee_amount]':String(fee),'metadata[company_id]':ctx.company,'metadata[user_id]':ctx.user.id,success_url:origin+'/client-payment-result?status=returned',cancel_url:origin+'/client-payment-result?status=cancelled'},connection.stripe_account_id,'cleanma-charge-'+ctx.company+'-'+input.request_id);return {url:session.url,application_fee_amount:fee};}
// Xero uses its own OAuth client and callback.
export async function oauthStart(ctx,provider,res){
 if(provider!=='xero')throw new Error('INVALID_REQUEST');
 await paid(ctx.company);env('PAYMENT_TOKEN_ENCRYPTION_KEY');
 const client=env('XERO_CLIENT_ID');env('XERO_CLIENT_SECRET');
 const state=randomBytes(32).toString('hex');
 await db('state',{hash:digest(state),company:ctx.company,user:ctx.user.id,provider});
 res.setHeader('Set-Cookie',`cleanma_oauth=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/api/xero/callback`);
 const u=new URL('https://login.xero.com/identity/connect/authorize');
 u.search=new URLSearchParams({response_type:'code',client_id:client,redirect_uri:origin+'/api/xero/callback',scope:'openid offline_access accounting.invoices.read accounting.contacts.read',state}).toString();
 return {url:u.href};
}
export async function oauthCallback(req,res){
 const q=new URL(req.url,origin).searchParams,state=q.get('state')||'',cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('cleanma_oauth='))?.slice(14);
 if(!/^[0-9a-f]{64}$/.test(state)||cookie!==state)throw new Error('INVALID_OAUTH_STATE');
 const callbackPath=new URL(req.url,origin).pathname;
 if(!['/api/payment-oauth','/api/xero/callback'].includes(callbackPath))throw new Error('INVALID_OAUTH_STATE');
 const saved=await db('consume_state',{hash:digest(state)});
 res.setHeader('Set-Cookie',`cleanma_oauth=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=${callbackPath}`);
 if(!saved||saved.provider!=='xero'||!q.get('code'))throw new Error('OAUTH_CANCELLED');
 const tokens=await request('https://identity.xero.com/connect/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:'Basic '+Buffer.from(env('XERO_CLIENT_ID')+':'+env('XERO_CLIENT_SECRET')).toString('base64')},body:new URLSearchParams({grant_type:'authorization_code',code:q.get('code'),redirect_uri:origin+callbackPath})});
 if(!tokens?.access_token||!tokens.refresh_token)throw new Error('XERO_TOKENS_REQUIRED');
 const tenants=await request('https://api.xero.com/connections',{headers:{Authorization:'Bearer '+tokens.access_token}});
 if(!Array.isArray(tenants)||!tenants.length)throw new Error('XERO_TENANT_REQUIRED');
 await db('save_connection',{company:saved.company_id,user:saved.user_id,provider:'xero',account_id:tenants.length===1?tenants[0].tenantId:null,ciphertext:seal({...tokens,tenants,expires_at:Date.now()+(tokens.expires_in||1800)*1000})});
 res.statusCode=303;res.setHeader('Location',origin+'/admin/settings?finance=integrations&integration=xero_return');return res.end();
}
export function expressStore(action,ctx,extra={}){
 return request(env('SUPABASE_URL')+'/rest/v1/rpc/cleanma_stripe_express_store',{method:'POST',headers:{apikey:env('SUPABASE_SERVICE_ROLE_KEY'),Authorization:'Bearer '+env('SUPABASE_SERVICE_ROLE_KEY'),'Content-Type':'application/json'},body:JSON.stringify({action,payload:{...extra,company:ctx.company,user:ctx.user.id}})});
}
function assertExpressAccount(account,ctx){
 if(account.type!=='express'||account.country!=='GB'||account.metadata?.company_id!==ctx.company||account.metadata?.app!=='cleanma')throw new Error('STRIPE_ACCOUNT_MISMATCH');
}
function assertConnectedAccount(account,ctx){
 if(account.type==='standard')return;
 assertExpressAccount(account,ctx);
}

const stripeCallbackPath='/api/stripe/connect/callback';
const stripeOauthCookie='cleanma_stripe_oauth';
const stripeCookieOptions='HttpOnly; Secure; SameSite=Lax; Path='+stripeCallbackPath;

export async function stripeOAuthStart(ctx,res){
 await paid(ctx.company);
 const clientId=process.env.STRIPE_CLIENT_ID?.trim()||process.env.NEXT_PUBLIC_STRIPE_CLIENT_ID?.trim();
 if(!clientId){
  console.error('[Stripe Connect] Missing STRIPE_CLIENT_ID (or NEXT_PUBLIC_STRIPE_CLIENT_ID) in the runtime environment.');
  throw new Error('STRIPE_CLIENT_ID_MISSING');
 }
 if(!/^ca_[A-Za-z0-9]+$/.test(clientId)){
  console.error('[Stripe Connect] The configured Client ID must start with ca_ and contain only letters and digits after the prefix.');
  throw new Error('STRIPE_CLIENT_ID_INVALID');
 }
 await platform();
 const state=randomBytes(32).toString('hex');
 await db('state',{hash:digest(state),company:ctx.company,user:ctx.user.id,provider:'stripe'});
 res.setHeader('Set-Cookie',`${stripeOauthCookie}=${state}; Max-Age=600; ${stripeCookieOptions}`);
 const url=new URL('https://connect.stripe.com/oauth/authorize');
 url.search=new URLSearchParams({
  response_type:'code',
  client_id:clientId,
  scope:'read_write',
  redirect_uri:origin+stripeCallbackPath,
  state,
 }).toString();
 return {url:url.href};
}

export async function stripeOAuthCallback(req,res){
 const params=new URL(req.url,origin).searchParams;
 const state=params.get('state')||'';
 const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim())
  .find(x=>x.startsWith(stripeOauthCookie+'='))?.slice(stripeOauthCookie.length+1);
 if(!/^[a-f0-9]{64}$/.test(state)||cookie!==state)throw new Error('INVALID_OAUTH_STATE');
 const saved=await db('consume_state',{hash:digest(state)});
 res.setHeader('Set-Cookie',`${stripeOauthCookie}=; Max-Age=0; ${stripeCookieOptions}`);
 if(saved?.provider!=='stripe')throw new Error('INVALID_OAUTH_STATE');
 const code=params.get('code');
 if(params.get('error')||!code)throw new Error('OAUTH_CANCELLED');
 await paid(saved.company_id);
 const platformAccount=await platform();
 const secret=env('STRIPE_SECRET_KEY');
 const grant=await request('https://connect.stripe.com/oauth/token',{
  method:'POST',
  headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:'Basic '+Buffer.from(secret+':').toString('base64')},
  body:new URLSearchParams({grant_type:'authorization_code',code}),
 });
 const accountId=grant.stripe_user_id;
 const liveMode=/^(sk|rk)_live_/.test(secret);
 if(!/^acct_[a-zA-Z0-9]+$/.test(accountId||'')||accountId===platformAccount.id||
    grant.scope!=='read_write'||grant.livemode!==liveMode){
  throw new Error('STRIPE_ACCOUNT_MISMATCH');
 }
 const account=await stripe('accounts/'+accountId);
 if(account.id!==accountId||account.type!=='standard')throw new Error('STRIPE_ACCOUNT_MISMATCH');
 const key=env('SUPABASE_SERVICE_ROLE_KEY');
 await request(env('SUPABASE_URL')+'/rest/v1/rpc/cleanma_bind_stripe_standard',{
  method:'POST',
  headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
  body:JSON.stringify({target_company:saved.company_id,owner_id:saved.user_id,account_id:accountId}),
 });
}
export async function expressDashboard(ctx){
 await paid(ctx.company);await platform();
 const saved=await expressStore('get',ctx);
 if(!saved?.stripe_account_id)throw new Error('CONNECT_STRIPE_FIRST');
 const account=await stripe('accounts/'+saved.stripe_account_id);assertExpressAccount(account,ctx);
 if(!account.charges_enabled||!account.details_submitted)throw new Error('STRIPE_ACCOUNT_NOT_READY');
 return {url:(await stripe('accounts/'+account.id+'/login_links',{})).url};
}
export async function connectionStatus(ctx){
 const rows=(await db('status',{company:ctx.company})).filter(row=>row.provider!=='stripe');
 const saved=await expressStore('get',ctx);
 if(!saved?.stripe_account_id)return [...rows,{provider:'stripe',account_id:null,connected:false,charges_enabled:false,details_submitted:false,payouts_enabled:false}];
 try{
  await platform();const account=await stripe('accounts/'+saved.stripe_account_id);assertConnectedAccount(account,ctx);
  return [...rows,{provider:'stripe',account_id:account.id,connected:true,charges_enabled:account.charges_enabled===true,details_submitted:account.details_submitted===true,payouts_enabled:account.payouts_enabled===true,currently_due:account.requirements?.currently_due||[]}];
 }catch{return [...rows,{provider:'stripe',account_id:saved.stripe_account_id,connected:true,status_unavailable:true}];}
}
export function verifySignature(raw,header,secret,now=Date.now()){const parts=String(header||'').split(',');const timestamp=parts.find(x=>x.startsWith('t='))?.slice(2);if(!/^\d+$/.test(timestamp||'')||Math.abs(now/1000-Number(timestamp))>300)return false;const expected=createHmac('sha256',secret).update(timestamp+'.').update(raw).digest();return parts.filter(x=>x.startsWith('v1=')).some(x=>{const got=Buffer.from(x.slice(3),'hex');return got.length===expected.length&&timingSafeEqual(got,expected);});}
