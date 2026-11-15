import {oauthCallback,json} from '../server/payments.mjs';
export default async function handler(req,res){if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});try{return await oauthCallback(req,res);}catch{return json(res,400,{error:'Connection could not be completed. Restart from Settings.'});}}
