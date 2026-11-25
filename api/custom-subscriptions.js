import {body,json,origin} from '../server/payments.mjs';
import {owner,publicLink,ownerDashboard,ensureLink,checkout,ownerAction,
  requestPortal,portalRead,portalChange} from '../server/custom-subscriptions.mjs';

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Referrer-Policy','no-referrer');
  try{
    if(req.method==='GET'){
      const query=new URL(req.url,origin).searchParams;
      if(query.has('slug'))return json(res,200,await publicLink(query.get('slug')));
      if(query.has('portal'))return json(res,200,await portalRead(query.get('portal'),req.headers['x-portal-token']));
      return json(res,200,await ownerDashboard(await owner(req)));
    }
    if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
    if(req.headers.origin!==origin)return json(res,403,{error:'Origin not allowed'});
    const input=await body(req);
    if(input.action==='checkout')return json(res,200,await checkout(input));
    if(input.action==='request-portal')return json(res,200,await requestPortal(input));
    if(input.action==='portal-update')return json(res,200,await portalChange(input,req.headers['x-portal-token']));
    const ctx=await owner(req);
    if(input.action==='ensure-link')return json(res,200,await ensureLink(ctx));
    if(input.action==='owner-manage')return json(res,200,await ownerAction(ctx,input));
    return json(res,400,{error:'INVALID_REQUEST'});
  }catch(error){
    const message=error instanceof Error?error.message:'UNKNOWN_ERROR';
    const known=new Set(['LINK_UNAVAILABLE','LINK_EXPIRED','INVALID_REQUEST','INVALID_SELECTION',
      'INVALID_CUSTOMER','INVALID_EMAIL','COMPANY_UNAVAILABLE','CONNECT_STRIPE_FIRST',
      'STRIPE_ACCOUNT_MISMATCH','STRIPE_ACCOUNT_NOT_READY','SUBSCRIPTION_UNAVAILABLE',
      'PAYMENT_NOT_COMPLETED','SUBSCRIPTION_NOT_EDITABLE','SUBSCRIPTION_CHANGED',
      'OWNER_REQUIRED','UNAUTHORISED','GROWTH_OR_SCALE_REQUIRED']);
    return json(res,known.has(message)?400:503,{error:known.has(message)?message:
      message==='PORTAL_EMAIL_NOT_CONFIGURED'?'The client email service is not configured. Please contact the business.':
      'This request could not be completed. Please try again.'});
  }
}
