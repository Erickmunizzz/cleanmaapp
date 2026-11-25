import {createFileRoute} from '@tanstack/react-router';
import {useEffect,useState,type FormEvent} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';

type PublicPlan={id:string;company_name:string;name:string;description:string;monthly_price:string|number;
  cleans_per_month:number;fixed_day:string;fixed_time:string};
export const Route=createFileRoute('/subscribe/$planId')({component:ClientSubscriptionPage});
const gbp=new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'});

function ClientSubscriptionPage(){
  const {planId}=Route.useParams();
  const [plan,setPlan]=useState<PublicPlan|null>(null);
  const [connected,setConnected]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [name,setName]=useState('');
  const [email,setEmail]=useState('');
  const [phone,setPhone]=useState('');
  useEffect(()=>{
    let mounted=true;
    void fetch('/api/client-subscriptions?plan='+encodeURIComponent(planId)).then(async response=>{
      const value=await response.json();
      if(!response.ok)throw Error(value.error==='PLAN_UNAVAILABLE'?'This plan is no longer available.':value.error);
      if(mounted){setPlan(value.plan);setConnected(value.connected);}
    }).catch(reason=>{if(mounted)setError(reason.message||'Could not load plan.');})
      .finally(()=>{if(mounted)setLoading(false);});
    return()=>{mounted=false;};
  },[planId]);
  async function subscribe(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setError('');
    try{
      const response=await fetch('/api/client-subscriptions',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'checkout',plan_id:planId,name,email,phone}),
      });
      const result=await response.json();
      if(!response.ok)throw Error(result.error==='CONNECT_STRIPE_FIRST'
        ?'This business has not connected its Stripe account yet. Please contact the business.'
        :result.error==='STRIPE_ACCOUNT_NOT_READY'
        ?'Card payments are not yet enabled for this business. Please contact the business.'
        :result.error||'Checkout unavailable.');
      window.location.assign(result.url);
    }catch(reason){setError(reason instanceof Error?reason.message:'Checkout unavailable.');setBusy(false);}
  }
  const returned=typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('checkout');
  return <main className="min-h-screen bg-background p-5 text-foreground sm:p-10">
    <div className="mx-auto max-w-lg space-y-6 rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8">
      <div className="flex items-center gap-3"><img src="/cleanma-logo.jpg" alt="CleanMa" className="h-10 w-16 object-contain"/><strong>CleanMa · Secure subscriptions</strong></div>
      {loading?<p>Loading your cleaning plan…</p>:!plan?<p role="alert" className="text-destructive">{error||'Plan unavailable.'}</p>:<>
        <header className="space-y-2"><p className="text-sm text-muted-foreground">Offered by {plan.company_name}</p>
          <h1 className="text-3xl font-bold">{plan.name}</h1>
          <p className="text-sm text-muted-foreground">{plan.description||'Professional cleaning service'}</p></header>
        <div className="rounded-xl border border-border bg-surface-2 p-5">
          <p className="text-3xl font-bold">{gbp.format(Number(plan.monthly_price))}<span className="text-sm font-normal text-muted-foreground"> / month</span></p>
          <p className="mt-2 text-sm">{plan.cleans_per_month} cleans every month · {plan.fixed_day} from {plan.fixed_time.slice(0,5)} (UK time)</p>
        </div>
        {returned==='returned'&&<p role="status" className="text-sm">Thank you. Your subscription is confirmed only after Stripe verifies the payment. Your cleaning company will contact you about the schedule.</p>}
        {returned==='cancelled'&&<p role="status" className="text-sm">Checkout was cancelled. No subscription was activated.</p>}
        <form onSubmit={e=>void subscribe(e)} className="space-y-4">
          <label className="block text-sm font-semibold">Full name<Input required minLength={2} maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
          <label className="block text-sm font-semibold">Email<Input type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label>
          <label className="block text-sm font-semibold">Phone number<Input type="tel" required minLength={5} maxLength={30} value={phone} onChange={e=>setPhone(e.target.value)}/></label>
          <p className="text-xs text-muted-foreground">You will pay securely by card using Stripe Checkout. Your card details are entered on Stripe, not stored by CleanMa.</p>
          <p className="text-xs text-muted-foreground">Monthly recurring payment, automatically charged each month. Cancel any time through your cleaning company. Stripe processing and CleanMa's 1% platform fee are paid by the business, not added to the price shown above.</p>
          {!connected&&<p className="text-sm text-warning">This business must finish connecting Stripe before accepting subscriptions.</p>}
          {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" type="submit" disabled={!connected||busy}>{busy?'Opening Stripe…':'Subscribe securely with Stripe'}</Button>
        </form>
      </>}
    </div>
  </main>;
}
