import {createFileRoute} from '@tanstack/react-router';
import {useEffect,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {loadBillingChoice,pendingBillingChoice,saveBillingChoice,type BillingChoice} from '@/lib/billing-choice';
export const Route=createFileRoute('/planos')({component:Plans});
const prices={starter:{month:8999,year:92870,old:107988},growth:{month:17999,year:185750,old:215988},scale:{month:29999,year:309590,old:359988}};
const money=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
function Plans(){
 const [ready,setReady]=useState(false),[choice,setChoice]=useState<BillingChoice|null>(null),[plan,setPlan]=useState<BillingChoice['plan']>('starter'),[interval,setInterval]=useState<BillingChoice['billing_interval']>('month'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{let active=true;void(async()=>{try{const {data,error}=await supabase.auth.getUser();if(error||!data.user){location.replace('/admin/login'+location.search);return;}if(!active)return;setReady(true);const pending=pendingBillingChoice();const saved=pending?await saveBillingChoice(pending.plan,pending.interval):await loadBillingChoice();if(active&&saved){setChoice(saved);setPlan(saved.plan);setInterval(saved.billing_interval);}}catch(e){if(active)setError(e instanceof Error?e.message:'Não foi possível carregar a seleção.');}})();return()=>{active=false;};},[]);
 async function save(){setBusy(true);setError('');setMessage('');try{const saved=await saveBillingChoice(plan,interval);setChoice(saved);setMessage('Seleção salva na sua conta. Nenhuma cobrança foi realizada.');}catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar.');}finally{setBusy(false);}}
 if(!ready)return <p role="status" className="p-8">Verificando sua conta…</p>;
 const cost=prices[plan],annual=interval==='year';
 return <main className="mx-auto max-w-xl space-y-6 p-8"><h1 className="text-3xl font-bold">Sua assinatura CleanMa</h1><p>Escolha o plano e o período de cobrança. Os preços desta oferta são em reais (BRL).</p>
 {error&&<p role="alert" className="text-destructive">{error}</p>}{message&&<p role="status">{message}</p>}
 <label className="block">Plano<select value={plan} onChange={e=>setPlan(e.target.value as BillingChoice['plan'])} className="mt-2 block w-full rounded border border-border bg-card p-3"><option value="starter">Starter</option><option value="growth">Growth</option><option value="scale">Scale</option></select></label>
 <fieldset className="flex gap-5"><legend className="mb-2">Período</legend><label><input type="radio" name="interval" checked={!annual} onChange={()=>setInterval('month')}/> Mensal</label><label><input type="radio" name="interval" checked={annual} onChange={()=>setInterval('year')}/> Anual -14%</label></fieldset>
 <div className="rounded-xl border border-border bg-card p-5">{annual&&<p><s>De {money(cost.old)}</s> por</p>}<p className="text-3xl font-bold">{money(annual?cost.year:cost.month)} / {annual?'ano':'mês'}</p>{annual&&<p className="mt-2 text-sm">{money(Math.round(cost.year/12))} / mês — Você economiza {money(cost.old-cost.year)}</p>}</div>
 <button disabled={busy} onClick={()=>void save()} className="rounded-xl bg-primary px-5 py-3 text-primary-foreground disabled:opacity-60">{busy?'Salvando…':'Salvar seleção na minha conta'}</button>
 {choice&&<p className="text-sm text-muted-foreground">Seleção registrada: {choice.plan} · {choice.billing_interval==='year'?'anual':'mensal'} · {money(choice.amount_cents)}.</p>}
 <div role="status" className="rounded-xl border border-border p-4 text-sm">O checkout online ainda aguarda configuração do provedor de pagamentos. Salvar a seleção não ativa uma assinatura nem realiza cobrança. <a className="underline" href="mailto:support@cleanmaapp.com">Falar com o suporte</a>.</div>
 <div className="flex flex-wrap gap-5"><a href="/admin">Voltar ao painel</a><button onClick={()=>void supabase.auth.signOut().then(()=>location.replace('/auth'))}>Sair</button></div></main>;
}
