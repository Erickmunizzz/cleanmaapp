import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
const allowed=new Set(['https://cleanmaapp.com','https://www.cleanmaapp.com','https://cleanma-landing.vercel.app']);
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(allowed.has(origin)?{'Access-Control-Allow-Origin':origin}:{}),'Access-Control-Allow-Headers':'content-type,apikey','Access-Control-Allow-Methods':'POST, OPTIONS'};
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(!allowed.has(origin))return reply(403,{success:false,error:'Origin not allowed.'});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply(405,{success:false,error:'Method not allowed.'});
 // Public publishable key identifies the app; no service credential reaches the browser.
 if(req.headers.get('apikey')!=='sb_publishable_MQz1s2hIcpM-w83-akFCPA_TJDDgYjG')return reply(401,{success:false,error:'Application not authorised.'});
 if(Number(req.headers.get('content-length')||0)>4096)return reply(413,{success:false,error:'Submission too large.'});
 try{
  const raw=await req.text();if(raw.length>4096)return reply(413,{success:false,error:'Submission too large.'});
  const body=JSON.parse(raw);const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
  if(body.website)return reply(400,{success:false,error:'Invalid submission.'});
  if(body.consent!==true||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||/[\r\n]/.test(email))return reply(400,{success:false,error:'Enter a valid email and consent to receive tips and offers.'});
  const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
  const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret+':'+ip));
  const ipHash=Array.from(new Uint8Array(hash)).map(x=>x.toString(16).padStart(2,'0')).join('');
  const db=createClient(Deno.env.get('SUPABASE_URL')!,secret,{auth:{persistSession:false}});
  const {error}=await db.rpc('subscribe_newsletter',{email_input:email,ip_hash_input:ipHash});
  if(error){if(error.message.includes('RATE_LIMIT'))return reply(429,{success:false,error:'Too many attempts. Please try again in 15 minutes.'});console.error('newsletter_insert_failed',error.code);return reply(503,{success:false,error:'We could not save your email. Please try again.'});}
  return reply(200,{success:true});
 }catch{return reply(400,{success:false,error:'Invalid submission. Please try again.'});}
});
