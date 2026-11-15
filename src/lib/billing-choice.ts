import {supabase} from '@/integrations/supabase/client';
export type BillingChoice={plan:'starter'|'growth'|'scale';billing_interval:'month'|'year';currency:'brl';amount_cents:number;state:string};
const key='cleanma:billing-choice:v1';
export function pendingBillingChoice(){
 const params=new URLSearchParams(window.location.search);
 let plan=params.get('plan'),interval=params.get('interval');
 if(!plan){try{const saved=JSON.parse(localStorage.getItem(key)||'null');plan=saved?.plan;interval=saved?.interval;}catch{return null;}}
 if(!['starter','growth','scale'].includes(plan||'')||!['month','year'].includes(interval||''))return null;
 const result={plan:plan as BillingChoice['plan'],interval:interval as BillingChoice['billing_interval']};
 try{localStorage.setItem(key,JSON.stringify(result));}catch{/* URL still carries the selection. */}
 return result;
}
export async function saveBillingChoice(plan:BillingChoice['plan'],interval:BillingChoice['billing_interval']){
 const {data,error}=await supabase.rpc('save_subscription_selection' as never,{plan_input:plan,interval_input:interval} as never);
 if(error)throw new Error('Não foi possível salvar a seleção. A integração de assinaturas aguarda ativação no banco.');
 try{localStorage.removeItem(key);}catch{}
 return data as unknown as BillingChoice;
}
export async function loadBillingChoice(){const {data,error}=await supabase.rpc('my_subscription_selection' as never);if(error)throw new Error('A integração de assinaturas aguarda ativação no banco.');return data as unknown as BillingChoice|null;}
