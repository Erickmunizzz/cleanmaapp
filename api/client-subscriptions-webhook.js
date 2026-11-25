import {env,json,verifySignature,stripe} from '../server/payments.mjs';
import {syncStripeSubscription} from '../server/client-recurring.mjs';

export const config={api:{bodyParser:false}};
const subscriptionEvents=new Set([
  'customer.subscription.created','customer.subscription.updated',
  'customer.subscription.deleted','customer.subscription.paused','customer.subscription.resumed',
]);
const checkoutEvents=new Set([
  'checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed',
]);
const invoiceEvents=new Set([
  'invoice.paid','invoice.payment_failed','invoice.payment_action_required',
]);
const riskEvents=new Set(['charge.refunded','charge.dispute.created','radar.early_fraud_warning.created']);

async function subscriptionFromCharge(event){
  const object=event.data.object;
  const chargeId=event.type==='charge.refunded'?object.id:object.charge;
  if(typeof chargeId!=='string')return null;
  const charge=event.type==='charge.refunded'?object:await stripe('charges/'+chargeId,undefined,event.account);
  const intent=typeof charge.payment_intent==='string'?
    await stripe('payment_intents/'+charge.payment_intent,undefined,event.account):null;
  const invoiceId=intent?.invoice||charge.invoice;
  if(typeof invoiceId!=='string')return null;
  const invoice=await stripe('invoices/'+invoiceId,undefined,event.account);
  return invoice.subscription||invoice.parent?.subscription_details?.subscription||null;
}

export default async function handler(req,res){
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  try{
    let raw=Buffer.alloc(0);
    for await(const chunk of req){
      raw=Buffer.concat([raw,Buffer.from(chunk)]);
      if(raw.length>1048576)return json(res,413,{error:'Payload too large'});
    }
    if(!verifySignature(raw,req.headers['stripe-signature'],env('STRIPE_CONNECT_WEBHOOK_SECRET')))
      return json(res,400,{error:'Invalid signature'});
    const event=JSON.parse(raw);
    if(!event.account)return json(res,200,{received:true});
    let subscriptionId=null;
    if(checkoutEvents.has(event.type)){
      const session=event.data.object;
      if(session.mode!=='subscription'||
        (event.type==='checkout.session.completed'&&session.payment_status==='unpaid'))
        return json(res,200,{received:true});
      subscriptionId=session.subscription;
    }else if(subscriptionEvents.has(event.type))subscriptionId=event.data.object.id;
    else if(invoiceEvents.has(event.type)){
      const invoice=event.data.object;
      subscriptionId=invoice.subscription||invoice.parent?.subscription_details?.subscription;
    }else if(riskEvents.has(event.type))subscriptionId=await subscriptionFromCharge(event);
    else return json(res,200,{received:true});
    if(typeof subscriptionId!=='string')return json(res,200,{received:true});
    await syncStripeSubscription(event,subscriptionId);
    return json(res,200,{received:true});
  }catch{
    return json(res,503,{error:'Event not processed. Stripe should retry.'});
  }
}
