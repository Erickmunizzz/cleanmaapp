import {body,json,origin} from '../server/payments.mjs';
import {owner,publicPlan,ownerList,createPlan,updatePlan,customerCheckout,manageSubscription} from '../server/client-recurring.mjs';

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  try{
    if(req.method==='GET'){
      const url=new URL(req.url,origin);
      if(url.searchParams.has('plan'))return json(res,200,await publicPlan(url.searchParams.get('plan')));
      const ctx=await owner(req);
      return json(res,200,await ownerList(ctx));
    }
    if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
    if(req.headers.origin!==origin)return json(res,403,{error:'Origin not allowed'});
    const input=await body(req);
    if(input.action==='checkout')return json(res,200,await customerCheckout(input));
    const ctx=await owner(req);
    if(input.action==='create-plan')return json(res,200,await createPlan(ctx,input));
    if(input.action==='update-plan')return json(res,200,await updatePlan(ctx,input));
    if(input.action==='manage')return json(res,200,await manageSubscription(ctx,input));
    return json(res,400,{error:'INVALID_REQUEST'});
  }catch(error){
    const known=new Set(['INVALID_REQUEST','INVALID_PLAN','INVALID_CUSTOMER','PLAN_UNAVAILABLE',
      'CONNECT_STRIPE_FIRST','STRIPE_ACCOUNT_NOT_READY','STRIPE_ACCOUNT_MISMATCH',
      'SUBSCRIPTION_UNAVAILABLE','PAYMENT_NOT_COMPLETED','STRIPE_OPERATION_FAILED',
      'OWNER_REQUIRED','UNAUTHORISED','CONFIGURATION_REQUIRED']);
    const message=error instanceof Error?error.message:'UNKNOWN_ERROR';
    return json(res,known.has(message)?400:503,{error:known.has(message)?message:'The request could not be completed. Please try again.'});
  }
}
