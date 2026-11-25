import {useEffect,useState,type FormEvent} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Link} from '@tanstack/react-router';
import {timeSlots} from './builder-constants';

const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const gbp=(pence:number)=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(pence/100);
const field='block space-y-1.5 text-sm font-semibold';
const select='h-11 w-full rounded-xl border border-input bg-background px-3 text-sm';
type Company={company_name:string;connected:boolean};

export function CustomBuilder({slug}:{slug:string}){
  const [company,setCompany]=useState<Company|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [visits,setVisits]=useState(1);
  const [selectedDays,setSelectedDays]=useState<string[]>(['Monday']);
  const [start,setStart]=useState('09:00');
  const [hours,setHours]=useState(2);
  const [price,setPrice]=useState('30');
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[phone,setPhone]=useState('');
  const [address,setAddress]=useState(''),[postcode,setPostcode]=useState('');
  useEffect(()=>{
    let active=true;setLoading(true);setCompany(null);setError('');
    void fetch('/api/custom-subscriptions?slug='+encodeURIComponent(slug)).then(async response=>{
      const data=await response.json();
      if(!response.ok)throw Error(data.error==='LINK_UNAVAILABLE'?'This subscription link is no longer available.':data.error);
      if(active)setCompany(data);
    }).catch(reason=>{if(active)setError(reason.message||'Could not load this company.');})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[slug]);
  const validPrice=/^\d{1,4}(?:\.\d{1,2})?$/.test(price)&&Number(price)>=1&&Number(price)<=10000;
  const visitPence=validPrice?Math.round(Number(price)*100):0;
  const monthly=visitPence*visits*4;
  const validDays=selectedDays.length===visits;
  const returned=typeof window!=='undefined'?new URLSearchParams(window.location.search).get('checkout'):null;
  function toggleDay(day:string){setSelectedDays(current=>current.includes(day)?current.filter(value=>value!==day):
    current.length<visits?[...current,day]:current);}
  async function subscribe(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!validPrice||!validDays||!company?.connected)return;
    setBusy(true);setError('');
    try{
      const response=await fetch('/api/custom-subscriptions',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'checkout',slug,visits_per_week:visits,preferred_days:selectedDays,
          start_time:start,duration_hours:hours,price_per_visit:price,name,email,phone,address,postcode})});
      const result=await response.json();
      if(!response.ok)throw Error(result.error==='CONNECT_STRIPE_FIRST'||result.error==='STRIPE_ACCOUNT_NOT_READY'
        ?'This cleaning business must complete its Stripe Connect setup before accepting payments.'
        :result.error==='INVALID_SELECTION'?'Please check the number of visits, days and price.':result.error||'Unable to open Checkout.');
      window.location.assign(result.url);
    }catch(reason){setError(reason instanceof Error?reason.message:'Please try again.');setBusy(false);}
  }
  return <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:py-14">
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3"><img src="/cleanma-logo.jpg" alt="CleanMa" className="h-10 w-14 object-contain"/><span className="text-sm font-semibold text-muted-foreground">CleanMa · Secure monthly billing</span></div>
      {loading?<p>Loading your cleaning company…</p>:!company?<p role="alert" className="rounded-2xl border border-border p-6 text-destructive">{error||'Subscription link unavailable.'}</p>:<>
        <header className="rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8">
          <p className="text-sm font-semibold text-primary">{company.company_name}</p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Build Your Cleaning Subscription</h1>
          <p className="mt-3 text-muted-foreground">Choose your own cleaning schedule, preferred visit length and budget. One simple monthly payment, with no fixed packages.</p>
        </header>
        {returned==='returned'&&<p role="status" className="rounded-xl border border-border bg-card p-4 text-sm">Thank you. Stripe is verifying your payment. Your preferred visits will appear as pending owner approval once confirmed.</p>}
        {returned==='cancelled'&&<p role="status" className="rounded-xl border border-border bg-card p-4 text-sm">Checkout was cancelled. You can adjust your subscription below.</p>}
        <form onSubmit={e=>void subscribe(e)} className="space-y-6">
          <section className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8">
            <h2 className="text-xl font-semibold">Your cleaning schedule</h2>
            <label className={field}>Visits per week
              <select className={select} value={visits} onChange={e=>{
                const count=Number(e.target.value);setVisits(count);setSelectedDays(current=>current.slice(0,count));
              }}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}× per week</option>)}</select>
            </label>
            <fieldset><legend className="mb-2 text-sm font-semibold">Preferred days — choose exactly {visits}</legend>
              <div className="flex flex-wrap gap-2">{days.map(day=><label key={day} className={'cursor-pointer rounded-full border px-3 py-2 text-sm '+
                (selectedDays.includes(day)?'border-primary bg-primary-soft text-primary':'border-border bg-background')}>
                <input type="checkbox" checked={selectedDays.includes(day)} onChange={()=>toggleDay(day)} className="sr-only"/>{day}
              </label>)}</div>
              {!validDays&&<p role="alert" className="mt-2 text-xs text-destructive">Select {visits-selectedDays.length} more day(s) to continue.</p>}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={field}>Preferred start time
                <select className={select} value={start} onChange={e=>setStart(e.target.value)}>{timeSlots.map(slot=><option key={slot}>{slot}</option>)}</select>
              </label>
              <label className={field}>Duration per visit
                <select className={select} value={hours} onChange={e=>setHours(Number(e.target.value))}>{[2,3,4,5,6].map(h=><option key={h} value={h}>{h} hours</option>)}</select>
              </label>
            </div>
            <label className={field}>Your price per visit (£)
              <div className="relative"><span className="absolute left-3 top-3 text-muted-foreground">£</span>
                <Input className="pl-8" type="number" min="1" max="10000" step="0.01" inputMode="decimal" required value={price} onChange={e=>setPrice(e.target.value)}/>
              </div><span className="block text-xs font-normal text-muted-foreground">Enter the amount you would like to pay for each clean.</span>
            </label>
          </section>
          <section className="space-y-3 rounded-2xl border border-primary/30 bg-primary-soft p-6 sm:p-8" aria-live="polite">
            <h2 className="text-lg font-semibold">Your monthly subscription summary</h2>
            <p className="text-sm">{visits}× per week × {gbp(visitPence)}/visit × 4 weeks</p>
            <p className="text-4xl font-bold tabular-nums">{validPrice?gbp(monthly):'—'}<span className="ml-1 text-base font-normal">/month</span></p>
            <p className="text-sm">{selectedDays.join(', ')||'Select your days'} at {start} · {hours} hours per visit · billed monthly in GBP.</p>
            <p className="text-xs text-muted-foreground">This is the total you pay. CleanMa's 1% platform fee and Stripe processing costs are paid by the cleaning business.</p>
          </section>
          <section className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8">
            <h2 className="text-xl font-semibold">Your details</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={field}>Full name<Input required minLength={2} maxLength={120} autoComplete="name" value={name} onChange={e=>setName(e.target.value)}/></label>
              <label className={field}>Email address<Input type="email" required maxLength={254} autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
              <label className={field}>Phone number<Input required type="tel" minLength={5} maxLength={30} autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)}/></label>
              <label className={field}>Postcode<Input required minLength={4} maxLength={11} autoComplete="postal-code" value={postcode} onChange={e=>setPostcode(e.target.value)}/></label>
              <label className={field+' sm:col-span-2'}>Cleaning address<Input required minLength={6} maxLength={240} autoComplete="street-address" value={address} onChange={e=>setAddress(e.target.value)}/></label>
            </div>
            <p className="text-xs text-muted-foreground">You will be charged {validPrice?gbp(monthly):'your chosen amount'} automatically every month. You may cancel at any time. Your cleaning company must approve the schedule before visits begin. Payments are handled securely by Stripe.</p>
            {!company.connected&&<p role="alert" className="text-sm text-destructive">This company has not finished connecting Stripe. Please contact the cleaning business before subscribing.</p>}
            {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" type="submit" disabled={!company.connected||!validPrice||!validDays||busy}>{busy?'Opening Stripe Checkout…':'Subscribe — '+(validPrice?gbp(monthly):'')+'/month'}</Button>
            <Link to="/subscribe/$planId/manage" params={{planId:slug}} className="block text-center text-sm text-primary underline">Already subscribed? Manage your subscription</Link>
          </section>
        </form>
      </>}
    </div>
  </main>;
}
