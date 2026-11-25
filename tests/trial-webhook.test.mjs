import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {Readable} from 'node:stream';
import handler from '../api/stripe-webhook.js';

const claim='00000000-0000-4000-8000-000000000004';
const subscription={
  id:'sub_trialtest',customer:'cus_trialtest',status:'active',
  metadata:{claim_id:claim},current_period_end:1924992000,
  latest_invoice:'in_trialtest',
  items:{data:[{quantity:1,current_period_end:1924992000,price:{
    id:'price_1UbwFxFn9iiryRd5VAqtdCnN',currency:'gbp',unit_amount:8999,
    recurring:{interval:'month'},
  }}]},
};

async function deliver(type,object,subscriptionStatus='active'){
  const event={id:'evt_'+type.replaceAll('.','_'),type,created:1795570000,data:{object}};
  const raw=Buffer.from(JSON.stringify(event));
  const timestamp=Math.floor(Date.now()/1000);
  const signature=createHmac('sha256','test-signing-secret')
    .update(`${timestamp}.`).update(raw).digest('hex');
  const req=Object.assign(Readable.from([raw]),{
    method:'POST',headers:{'stripe-signature':`t=${timestamp},v1=${signature}`},
  });
  let saved;
  const original=global.fetch;
  const originalSecret=process.env.STRIPE_WEBHOOK_SECRET;
  const originalKey=process.env.STRIPE_SECRET_KEY;
  const originalUrl=process.env.SUPABASE_URL;
  const originalRole=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.STRIPE_WEBHOOK_SECRET='test-signing-secret';
  process.env.STRIPE_SECRET_KEY='test-only';
  process.env.SUPABASE_URL='https://test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';
  global.fetch=async(url,init)=>{
    if(url.includes('/subscriptions/'))return Response.json({...subscription,status:subscriptionStatus});
    if(url.includes('/invoices/'))return Response.json({id:'in_trialtest',status:'paid',subscription:subscription.id});
    if(url.includes('/payment_intents/'))return Response.json({invoice:'in_trialtest'});
    if(url.includes('/charges/'))return Response.json({payment_intent:'pi_trialtest'});
    if(url.includes('/cleanma_payment_store')){
      saved=JSON.parse(init.body).payload;
      return Response.json({});
    }
    throw Error('Unexpected fetch '+url);
  };
  const res={statusCode:200,setHeader(){},end(value){this.payload=value;}};
  try{await handler(req,res);return {res,saved};}
  finally{
    global.fetch=original;
    for(const [key,value] of Object.entries({
      STRIPE_WEBHOOK_SECRET:originalSecret,STRIPE_SECRET_KEY:originalKey,
      SUPABASE_URL:originalUrl,SUPABASE_SERVICE_ROLE_KEY:originalRole,
    }))if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
}

test('paid Checkout activates a company only through the signed webhook',async()=>{
  const {res,saved}=await deliver('checkout.session.completed',{mode:'subscription',subscription:subscription.id});
  assert.equal(res.statusCode,200);
  assert.equal(saved.status,'active');
  assert.equal(saved.customer_id,'cus_trialtest');
});

test('cancelled subscriptions and failed invoices remove paid access',async()=>{
  for(const [type,object,state] of [
    ['customer.subscription.deleted',{id:subscription.id},'canceled'],
    ['invoice.payment_failed',{subscription:subscription.id},'past_due'],
  ]){
    const {res,saved}=await deliver(type,object,state);
    assert.equal(res.statusCode,200);
    assert.notEqual(saved.status,'active');
  }
});

test('disputes and refunds block access even if subscription remains active',async()=>{
  const {res,saved}=await deliver('charge.refunded',{id:'ch_trialtest',payment_intent:'pi_trialtest'});
  assert.equal(res.statusCode,200);
  assert.equal(saved.status,'past_due');
});
