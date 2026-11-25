import {env,verifySignature,stripe,db,json,catalog} from '../server/payments.mjs';

export const config={api:{bodyParser:false}};

const subscriptionEvents=new Set([
  'customer.subscription.created','customer.subscription.updated',
  'customer.subscription.deleted','customer.subscription.paused',
  'customer.subscription.resumed',
]);
const invoiceEvents=new Set([
  'invoice.paid','invoice.payment_failed','invoice.payment_action_required',
]);
const checkoutEvents=new Set([
  'checkout.session.completed','checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
]);
const riskEvents=new Set([
  'charge.refunded','charge.dispute.created','radar.early_fraud_warning.created',
]);

async function subscriptionFromCharge(event){
  const object=event.data.object;
  const chargeId=event.type==='charge.refunded'?object.id:object.charge;
  if(typeof chargeId!=='string')return null;
  const charge=event.type==='charge.refunded'?object:await stripe('charges/'+chargeId);
  const paymentIntent=typeof charge.payment_intent==='string'
    ?await stripe('payment_intents/'+charge.payment_intent):null;
  const invoiceId=paymentIntent?.invoice||charge.invoice;
  if(typeof invoiceId!=='string')return null;
  const invoice=await stripe('invoices/'+invoiceId);
  return invoice.subscription||invoice.parent?.subscription_details?.subscription||null;
}

export default async function handler(req,res){
  if(req.method!=='POST')return json(res,405,{});
  try{
    let raw=Buffer.alloc(0);
    for await(const chunk of req){
      raw=Buffer.concat([raw,Buffer.from(chunk)]);
      if(raw.length>1048576)return json(res,413,{});
    }
    if(!verifySignature(raw,req.headers['stripe-signature'],env('STRIPE_WEBHOOK_SECRET')))
      return json(res,400,{error:'Invalid signature'});
    const event=JSON.parse(raw);
    // Connected-account transactions are not SaaS subscription payments.
    if(event.account)return json(res,200,{received:true});

    let id=null;
    if(checkoutEvents.has(event.type)){
      if(event.data.object.mode!=='subscription')return json(res,200,{received:true});
      id=event.data.object.subscription;
    }else if(invoiceEvents.has(event.type)){
      id=event.data.object.subscription||event.data.object.parent?.subscription_details?.subscription;
    }else if(subscriptionEvents.has(event.type)){
      id=event.data.object.id;
    }else if(riskEvents.has(event.type)){
      id=await subscriptionFromCharge(event);
      if(!id)return json(res,200,{received:true});
    }else return json(res,200,{received:true});

    if(typeof id!=='string')throw Error('MISSING_SUBSCRIPTION');
    const sub=await stripe('subscriptions/'+id);
    if(!/^[0-9a-f-]{36}$/i.test(sub.metadata?.claim_id||''))
      return json(res,200,{received:true});
    const item=sub.items?.data?.[0],interval=item?.price?.recurring?.interval;
    const plan=Object.keys(catalog).find(t=>catalog[t]?.[interval]?.[0]===item?.price?.id);
    const selected=catalog[plan]?.[interval];
    if(!selected||sub.items.data.length!==1||item.quantity!==1||item.price.id!==selected[0]
       ||item.price.currency!=='gbp'||item.price.unit_amount!==selected[1])
      throw Error('UNRECOGNISED_PRICE');
    const invoice=typeof sub.latest_invoice==='string'
      ?await stripe('invoices/'+sub.latest_invoice):sub.latest_invoice;
    // Risk-side events must block access, even if Stripe still reports an active subscription.
    const status=riskEvents.has(event.type)?'past_due':
      sub.status==='active'&&invoice?.status==='paid'?'active':
      sub.status==='canceled'?'cancelled':sub.status==='past_due'?'past_due':'inactive';
    const periodEnd=item.current_period_end||sub.current_period_end;
    if(!Number.isFinite(periodEnd))throw Error('INVALID_SUBSCRIPTION_PERIOD');
    await db('apply_subscription',{
      event_id:event.id,claim_id:sub.metadata.claim_id,subscription_id:sub.id,
      customer_id:sub.customer,plan,status,event_created:event.created,
      period_end:new Date(periodEnd*1000).toISOString(),
    });
    return json(res,200,{received:true});
  }catch{
    return json(res,503,{error:'Event not processed. Retry required.'});
  }
}
