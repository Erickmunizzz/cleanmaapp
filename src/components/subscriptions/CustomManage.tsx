import {useEffect,useState,type FormEvent} from 'react';
import {Link} from '@tanstack/react-router';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {timeSlots} from './builder-constants';

const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const gbp=(pence:number)=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(pence/100);
type Subscription={id:string;visits_per_week:number;preferred_days:string[];start_time:string;
  duration_hours:number;price_per_visit_pence:number;monthly_amount_pence:number;status:string;
  next_billing_date:string|null;schedule_version:number};
type Visit={service_date:string;scheduled_at:string;status:string};

export function CustomManage({slug}:{slug:string}){
  const [token,setToken]=useState('');
  const [subscription,setSubscription]=useState<Subscription|null>(null);
  const [nextVisits,setNextVisits]=useState<Visit[]>([]);
  const [email,setEmail]=useState('');
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
  const [visits,setVisits]=useState(1),[selectedDays,setSelectedDays]=useState<string[]>([]);
  const [start,setStart]=useState('09:00'),[hours,setHours]=useState(2),[price,setPrice]=useState('30');
  async function read(access:string){
    const response=await fetch('/api/custom-subscriptions?portal='+encodeURIComponent(slug),
      {headers:{'x-portal-token':access},cache:'no-store'});
    const data=await response.json();
    if(!response.ok)throw Error(data.error==='LINK_EXPIRED'?'This secure link has expired. Request a new one below.':data.error);
    const s=data.subscription as Subscription;
    setSubscription(s);setNextVisits(data.visits||[]);
    setVisits(s.visits_per_week);setSelectedDays(s.preferred_days);setStart(s.start_time.slice(0,5));
    setHours(s.duration_hours);setPrice((s.price_per_visit_pence/100).toFixed(2));
  }
  useEffect(()=>{
    const url=new URL(window.location.href);
    const access=url.searchParams.get('access')||sessionStorage.getItem('cleanma-custom-portal-'+slug)||'';
    if(url.searchParams.has('access')){
      url.searchParams.delete('access');window.history.replaceState(null,'',url.pathname+url.search+url.hash);
    }
    if(access){sessionStorage.setItem('cleanma-custom-portal-'+slug,access);setToken(access);
      void read(access).catch(reason=>{setError(reason.message);setToken('');sessionStorage.removeItem('cleanma-custom-portal-'+slug);});}
  },[slug]);
  const validPrice=/^\d{1,4}(?:\.\d{1,2})?$/.test(price)&&Number(price)>=1&&Number(price)<=10000;
  const monthly=validPrice?Math.round(Number(price)*100)*visits*4:0;
  function toggle(day:string){setSelectedDays(current=>current.includes(day)?current.filter(x=>x!==day):
    current.length<visits?[...current,day]:current);}
  async function requestAccess(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setError('');setNotice('');
    try{
      const response=await fetch('/api/custom-subscriptions',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'request-portal',slug,email})});
      const data=await response.json();if(!response.ok)throw Error(data.error||'Could not send an email.');
      setNotice('If a subscription matches this email address, a secure 30-minute link will arrive shortly. Check your junk folder too.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Please try again.');}finally{setBusy(false);}
  }
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!subscription||!token||!validPrice||selectedDays.length!==visits)return;
    setBusy(true);setNotice('');setError('');
    try{
      const response=await fetch('/api/custom-subscriptions',{method:'POST',headers:{'Content-Type':'application/json','x-portal-token':token},
        body:JSON.stringify({action:'portal-update',slug,schedule_version:subscription.schedule_version,
          visits_per_week:visits,preferred_days:selectedDays,start_time:start,duration_hours:hours,price_per_visit:price})});
      const data=await response.json();
      if(!response.ok)throw Error(data.error==='SUBSCRIPTION_CHANGED'?'Your subscription changed elsewhere. Refresh before editing again.':data.error||'Could not save changes.');
      await read(token);
      setNotice('Your changes are saved. The new amount applies from the next billing cycle; your future visits have been updated.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Please try again.');}finally{setBusy(false);}
  }
  return <main className="min-h-screen bg-background px-4 py-10 text-foreground">
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/subscribe/$planId" params={{planId:slug}} className="text-sm text-primary underline">Back to subscription builder</Link>
      <div className="rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8">
        <h1 className="text-3xl font-bold">Manage Your Cleaning Subscription</h1>
        <p className="mt-2 text-sm text-muted-foreground">Access your subscription securely by email. No CleanMa account or password required.</p>
      </div>
      {!subscription&&<form onSubmit={e=>void requestAccess(e)} className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-card">
        <label className="block space-y-2 text-sm font-semibold">Your subscription email
          <Input type="email" required maxLength={254} autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/>
        </label>
        <Button type="submit" disabled={busy}>{busy?'Sending…':'Email me a secure management link'}</Button>
      </form>}
      {subscription&&<form onSubmit={e=>void save(e)} className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8">
        <div><p className="text-xs uppercase text-muted-foreground">Current subscription</p><p className="text-2xl font-bold">{gbp(subscription.monthly_amount_pence)}/month</p>
          <p className="text-sm capitalize">Status: {subscription.status.replaceAll('_',' ')} · Next billing: {subscription.next_billing_date??'Pending'}</p>
          <p className="text-xs text-muted-foreground">Changes to your rate take effect on your next invoice. No mid-cycle pro-rata charge.</p>
        </div>
        {!!nextVisits.length&&<div className="rounded-xl bg-surface-2 p-4 text-sm">
          <p className="font-semibold">Your next visit</p>
          <p>{new Date(nextVisits[0]!.scheduled_at).toLocaleString('en-GB',{timeZone:'Europe/London',weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})}</p>
          <p className="text-xs capitalize text-muted-foreground">{nextVisits[0]!.status.replaceAll('_',' ')}</p>
        </div>}
        <h2 className="font-semibold">Change your future schedule and price</h2>
        <label className="block space-y-1 text-sm font-semibold">Visits per week
          <select className="h-11 w-full rounded-xl border border-input bg-background px-3" value={visits} onChange={e=>{
            const count=Number(e.target.value);setVisits(count);setSelectedDays(current=>current.slice(0,count));
          }}>{[1,2,3,4,5].map(n=><option value={n} key={n}>{n}× per week</option>)}</select>
        </label>
        <fieldset><legend className="mb-2 text-sm font-semibold">Preferred days ({selectedDays.length} of {visits})</legend>
          <div className="flex flex-wrap gap-2">{days.map(day=><label key={day} className={'cursor-pointer rounded-full border px-3 py-2 text-sm '+
            (selectedDays.includes(day)?'border-primary bg-primary-soft text-primary':'border-border')}>
            <input className="sr-only" type="checkbox" checked={selectedDays.includes(day)} onChange={()=>toggle(day)}/>{day}
          </label>)}</div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1 text-sm font-semibold">Start time
            <select className="h-11 w-full rounded-xl border border-input bg-background px-3" value={start} onChange={e=>setStart(e.target.value)}>{timeSlots.map(time=><option key={time}>{time}</option>)}</select>
          </label>
          <label className="block space-y-1 text-sm font-semibold">Hours per visit
            <select className="h-11 w-full rounded-xl border border-input bg-background px-3" value={hours} onChange={e=>setHours(Number(e.target.value))}>{[2,3,4,5,6].map(n=><option key={n} value={n}>{n} hours</option>)}</select>
          </label>
        </div>
        <label className="block space-y-1 text-sm font-semibold">Price per visit (£)
          <Input type="number" inputMode="decimal" required min="1" max="10000" step="0.01" value={price} onChange={e=>setPrice(e.target.value)}/>
        </label>
        <div className="rounded-xl bg-primary-soft p-4"><p className="text-sm">{visits}× per week × {gbp(validPrice?Math.round(Number(price)*100):0)}/visit × 4 weeks</p>
          <p className="text-3xl font-bold">{validPrice?gbp(monthly):'—'}/month</p></div>
        <Button type="submit" className="w-full" disabled={busy||!validPrice||selectedDays.length!==visits||!['active','pending_approval'].includes(subscription.status)}>
          {busy?'Saving…':'Save subscription changes'}</Button>
        <p className="text-xs text-muted-foreground">Your cleaning company receives updated calendar visits automatically. For payment methods, refunds or cancellation, contact the business directly.</p>
      </form>}
      {notice&&<p role="status" className="rounded-xl border border-border bg-card p-4 text-sm">{notice}</p>}
      {error&&<p role="alert" className="rounded-xl border border-destructive bg-card p-4 text-sm text-destructive">{error}</p>}
    </div>
  </main>;
}
