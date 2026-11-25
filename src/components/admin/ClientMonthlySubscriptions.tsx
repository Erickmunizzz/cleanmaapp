import {useState, type FormEvent} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {supabase} from '@/integrations/supabase/client';

type Plan={id:string;name:string;description:string;monthly_price:number|string;cleans_per_month:number;
  fixed_day:string;fixed_time:string;active:boolean;created_at:string};
type Subscriber={id:string;plan_id:string;client_name:string;client_email:string;client_phone:string;
  status:'active'|'paused'|'canceled'|'past_due';next_billing_date:string|null;checkout_pending:boolean;
  stripe_subscription_id:string|null;created_at:string};
type Alert={id:string;subscription_id:string;message:string;created_at:string};
type Clean={id:string;subscription_id:string;service_date:string;status:string};
type Dashboard={plans:Plan[];subscribers:Subscriber[];alerts:Alert[];cleans:Clean[]};
type Result={updated?:boolean;skipped?:boolean;service_date?:string};
const gbp=(amount:number)=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(amount);
const field='grid min-w-0 gap-1.5 text-xs font-semibold uppercase';
const select='h-10 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-sm';
const template=[
  {name:'Fortnightly Essential',description:'2 scheduled cleans each month',cleans_per_month:2},
  {name:'Weekly (Most Popular)',description:'4 scheduled cleans each month',cleans_per_month:4},
  {name:'Premium',description:'8 scheduled cleans each month (two days per week)',cleans_per_month:8},
];
const weekdays=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

async function api<T>(input?:Record<string,unknown>):Promise<T>{
  const session=await supabase.auth.getSession();
  if(!session.data.session)throw Error('Sign in to manage client subscriptions.');
  const response=await fetch('/api/client-subscriptions',{
    method:input?'POST':'GET',headers:{Authorization:'Bearer '+session.data.session.access_token,
      ...(input?{'Content-Type':'application/json'}:{})},
    ...(input?{body:JSON.stringify(input)}:{}),
  });
  const data=await response.json();
  if(!response.ok)throw Error(data.error==='CONNECT_STRIPE_FIRST'
    ?'Connect your Stripe account above before managing recurring payments.'
    :data.error==='CONFIGURATION_REQUIRED'
      ?'Stripe configuration is incomplete on the server. Check the Vercel environment variables.'
      :data.error||'Request failed.');
  return data as T;
}

export function ClientMonthlySubscriptions({companyId,enabled}:{companyId:string;enabled:boolean}){
  const qc=useQueryClient();
  const queryKey=['client-monthly-subscriptions',companyId];
  const query=useQuery({queryKey,queryFn:()=>api<Dashboard>(),enabled});
  const [open,setOpen]=useState(false);
  const [notice,setNotice]=useState('');
  const [name,setName]=useState('');
  const [description,setDescription]=useState('');
  const [price,setPrice]=useState('');
  const [cleans,setCleans]=useState(4);
  const [fixedDay,setFixedDay]=useState('Monday');
  const [fixedTime,setFixedTime]=useState('09:00');
  const [copy,setCopy]=useState('');
  const save=useMutation({
    mutationFn:()=>api<{id:string}>({action:'create-plan',name,description,monthly_price:price,
      cleans_per_month:cleans,fixed_day:fixedDay,fixed_time:fixedTime}),
    onSuccess:async()=>{
      setOpen(false);setName('');setDescription('');setPrice('');setNotice('Plan saved. Copy its public subscription link below.');
      await qc.invalidateQueries({queryKey});
    },
  });
  const change=useMutation({
    mutationFn:(values:Record<string,unknown>)=>api<Result>(values),
    onSuccess:async(data,values)=>{
      setNotice(values['action']==='manage'&&values['operation']==='skip'
        ?data.skipped?`Skipped the clean on ${data.service_date}. Billing remains active.`:'No upcoming clean to skip.'
        :'Subscription updated. Stripe may take a moment to send its confirmation.');
      await qc.invalidateQueries({queryKey});
    },
  });
  const plans=query.data?.plans??[];
  const subscribers=query.data?.subscribers??[];
  const active=subscribers.filter(s=>s.status==='active'&&!s.checkout_pending);
  const mrr=active.reduce((sum,s)=>sum+Number(plans.find(p=>p.id===s.plan_id)?.monthly_price??0),0);
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(enabled&&!save.isPending)save.mutate();}
  async function copyLink(id:string){
    const url=new URL('/subscribe/'+id,window.location.origin).href;
    try{await navigator.clipboard.writeText(url);setCopy('Subscription link copied.');}
    catch{setCopy('Copy this link: '+url);}
  }
  function manage(id:string,operation:'skip'|'pause'|'resume'|'cancel'){
    if(operation==='cancel'&&!window.confirm('Cancel this client subscription in Stripe now? This cannot be undone.'))return;
    change.mutate({action:'manage',subscription_id:id,operation});
  }
  return <section className="min-w-0 space-y-5 rounded-2xl border border-border bg-card p-5 shadow-card" aria-labelledby="client-recurring-heading">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 id="client-recurring-heading" className="text-xl font-semibold">Client Monthly Subscriptions</h2>
        <p className="text-sm text-muted-foreground">Recurring cleans, monthly billing and automatic scheduling. CleanMa retains 1%; Stripe processing fees are separate.</p></div>
      <Button type="button" disabled={!enabled} onClick={()=>setOpen(current=>!current)}>{open?'Close form':'Create new plan'}</Button>
    </header>
    {!enabled&&<p className="text-sm text-muted-foreground">Available for businesses with Growth or Scale access.</p>}
    {enabled&&<div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-border bg-surface-2 p-4"><p className="text-xs text-muted-foreground">Active subscribers</p><p className="text-2xl font-bold tabular-nums">{active.length}</p></div>
      <div className="rounded-xl border border-border bg-surface-2 p-4"><p className="text-xs text-muted-foreground">Estimated MRR (gross)</p><p className="text-2xl font-bold tabular-nums">{gbp(mrr)}</p></div>
    </div>}
    {open&&enabled&&<form onSubmit={submit} className="space-y-4 rounded-xl border border-border p-4">
      <div><p className="mb-2 text-sm font-semibold">Quick templates</p><div className="flex flex-wrap gap-2">
        {template.map(p=><Button type="button" size="sm" variant="outline" key={p.name}
          onClick={()=>{setName(p.name);setDescription(p.description);setCleans(p.cleans_per_month);}}>{p.name}</Button>)}
      </div><p className="mt-2 text-xs text-muted-foreground">Choose a template to prefill the form, then enter your monthly price.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={field}>Plan name<Input required maxLength={100} minLength={2} value={name} onChange={e=>setName(e.target.value)} /></label>
        <label className={field}>Monthly price (GBP)<Input type="number" required min="1" max="1000000" step="0.01" value={price} onChange={e=>setPrice(e.target.value)}/></label>
        <label className={field+' sm:col-span-2'}>Description<Input maxLength={500} value={description} onChange={e=>setDescription(e.target.value)}/></label>
        <label className={field}>Cleans per month<Input required type="number" min="1" max="8" step="1" value={cleans} onChange={e=>setCleans(Number(e.target.value))}/></label>
        <label className={field}>Fixed weekday<select className={select} value={fixedDay} onChange={e=>setFixedDay(e.target.value)}>{weekdays.map(day=><option key={day}>{day}</option>)}</select></label>
        <label className={field}>Fixed start time<input className={select} required type="time" value={fixedTime} onChange={e=>setFixedTime(e.target.value)}/></label>
      </div>
      <p className="text-xs text-muted-foreground">All times use Europe/London. Plans with 5–8 cleans/month use a second weekly day, three days after the selected day.</p>
      <Button disabled={save.isPending} type="submit">{save.isPending?'Saving…':'Save plan'}</Button>
      {save.error&&<p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
    </form>}
    {notice&&<p role="status" className="text-sm text-success-strong">{notice}</p>}
    {copy&&<p role="status" className="break-all text-xs">{copy}</p>}
    {enabled&&(query.isPending?<p className="text-sm">Loading plans and subscribers…</p>:
      query.error?<p role="alert" className="text-sm text-destructive">{query.error.message} <button className="underline" onClick={()=>void query.refetch()}>Retry</button></p>:
      <div className="space-y-5">
        <div><h3 className="mb-3 font-semibold">Your monthly plans</h3>
          {!plans.length&&<p className="text-sm text-muted-foreground">No plans yet. Create one above.</p>}
          <div className="grid gap-3 lg:grid-cols-2">{plans.map(p=><div key={p.id} className="min-w-0 space-y-2 rounded-xl border border-border p-4">
            <div className="flex items-center justify-between gap-2"><strong className="break-words">{p.name}</strong><span className="text-xs text-muted-foreground">{p.active?'Active':'Inactive'}</span></div>
            <p className="text-sm text-muted-foreground">{p.description||'Monthly cleaning'} · {p.cleans_per_month} cleans/month · {p.fixed_day} {p.fixed_time.slice(0,5)}</p>
            <p className="font-semibold">{gbp(Number(p.monthly_price))}/month</p>
            <a href={'/subscribe/'+p.id} target="_blank" rel="noreferrer" className="block break-all text-xs text-primary underline">{new URL('/subscribe/'+p.id,'https://cleanmaapp.com').href}</a>
            <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={()=>void copyLink(p.id)}>Copy public link</Button>
              <Button type="button" size="sm" variant="outline" disabled={change.isPending} onClick={()=>change.mutate({action:'update-plan',plan_id:p.id,active:!p.active})}>{p.active?'Deactivate':'Activate'}</Button></div>
          </div>)}</div>
        </div>
        <div><h3 className="mb-3 font-semibold">Client subscribers</h3>
          {!subscribers.length&&<p className="text-sm text-muted-foreground">No customers have started a recurring checkout.</p>}
          <div className="space-y-3">{subscribers.map(s=>{
            const p=plans.find(x=>x.id===s.plan_id);
            const next=query.data?.cleans.find(c=>c.subscription_id===s.id&&c.status==='scheduled'&&c.service_date>=new Date().toISOString().slice(0,10));
            return <div key={s.id} className="min-w-0 rounded-xl border border-border p-4">
              <div className="flex flex-wrap justify-between gap-2"><div><p className="font-semibold">{s.client_name}</p>
                <p className="break-all text-xs text-muted-foreground">{s.client_email} · {p?.name??'Plan unavailable'}</p></div>
                <span className="text-xs font-semibold capitalize">{s.checkout_pending?'Awaiting Checkout':s.status.replace('_',' ')}</span></div>
              <p className="mt-2 text-xs text-muted-foreground">Next billing: {s.next_billing_date??'Pending'} · Next clean: {next?.service_date??'Not scheduled'}</p>
              {!s.checkout_pending&&<div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" disabled={change.isPending||s.status==='canceled'} onClick={()=>manage(s.id,'skip')}>Skip next clean</Button>
                {s.status==='paused'?<Button type="button" size="sm" variant="outline" disabled={change.isPending} onClick={()=>manage(s.id,'resume')}>Resume subscription</Button>:
                  <Button type="button" size="sm" variant="outline" disabled={change.isPending||s.status==='canceled'} onClick={()=>manage(s.id,'pause')}>Pause subscription</Button>}
                <Button type="button" size="sm" variant="outline" disabled={change.isPending||s.status==='canceled'} onClick={()=>manage(s.id,'cancel')}>Cancel subscription</Button>
              </div>}
            </div>;
          })}</div>
          {change.error&&<p role="alert" className="mt-3 text-sm text-destructive">{change.error.message}</p>}
        </div>
        {!!query.data?.alerts.length&&<div role="alert" className="space-y-2 rounded-xl border border-warning p-4">
          <h3 className="font-semibold">Payment alerts</h3>
          {query.data.alerts.map(a=><p className="text-sm" key={a.id}>{a.message} <span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleDateString('en-GB')}</span></p>)}
        </div>}
      </div>)}
  </section>;
}
