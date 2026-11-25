import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Link2,Copy,CheckCircle,CalendarClock} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {supabase} from '@/integrations/supabase/client';

type Subscriber={id:string;client_name:string;client_email:string;visits_per_week:number;
  preferred_days:string[];start_time:string;monthly_amount_pence:number;status:string;
  owner_approved:boolean;next_billing_date:string|null;scheduling_error:string|null;created_at:string};
type Visit={id:string;subscription_id:string;service_date:string;status:string;scheduled_at:string};
type Dashboard={link:{id:string;slug:string;enabled:boolean}|null;subscribers:Subscriber[];visits:Visit[]};
const gbp=(pence:number)=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(pence/100);

async function api<T>(input?:Record<string,unknown>):Promise<T>{
  const {data:{session}}=await supabase.auth.getSession();
  if(!session)throw Error('Sign in as an owner to manage subscriptions.');
  const response=await fetch('/api/custom-subscriptions',{
    method:input?'POST':'GET',headers:{Authorization:'Bearer '+session.access_token,
      ...(input?{'Content-Type':'application/json'}:{})},
    ...(input?{body:JSON.stringify(input)}:{})});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'Unable to load custom subscriptions.');
  return data as T;
}

export function CustomSubscriptionOwner({companyId,enabled}:{companyId:string;enabled:boolean}){
  const key=['custom-client-subscriptions',companyId],client=useQueryClient();
  const query=useQuery({queryKey:key,queryFn:()=>api<Dashboard>(),enabled});
  const [notice,setNotice]=useState('');
  const create=useMutation({mutationFn:()=>api<{slug:string}>({action:'ensure-link'}),
    onSuccess:async()=>{setNotice('Your subscription link is ready.');await client.invalidateQueries({queryKey:key});}});
  const manage=useMutation({mutationFn:(values:Record<string,unknown>)=>api<{updated?:boolean;skipped?:number}>(values),
    onSuccess:async(result,values)=>{
      setNotice(values['operation']==='skip-next'||values['operation']==='skip-week'
        ?`${result.skipped??0} upcoming visit(s) skipped. Monthly billing continues.`
        :'Subscription updated. Stripe will confirm the final state shortly.');
      await client.invalidateQueries({queryKey:key});
    }});
  const subscriptions=query.data?.subscribers??[];
  const active=subscriptions.filter(s=>s.status==='active');
  const mrr=active.reduce((sum,sub)=>sum+sub.monthly_amount_pence,0);
  const slug=query.data?.link?.slug;
  const url=slug?'https://cleanmaapp.com/subscribe/'+slug:'';
  async function copy(){try{await navigator.clipboard.writeText(url);setNotice('Subscription link copied.');}
    catch{setNotice('Copy the address shown below.');}}
  function operation(id:string,action:string){
    if(['decline','cancel'].includes(action)&&!window.confirm(
      'This immediately cancels future Stripe billing and visits. Any payment already taken may need a refund in Stripe. Continue?'))return;
    manage.mutate({action:'owner-manage',subscription_id:id,operation:action});
  }
  return <section className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-card" aria-labelledby="custom-builder-title">
    <header className="space-y-2">
      <h2 id="custom-builder-title" className="flex items-center gap-2 text-xl font-bold"><Link2 className="size-5 text-primary"/> Custom client subscriptions</h2>
      <p className="text-sm text-muted-foreground">Your clients build their own cleaning subscriptions and suggest their price per visit. No fixed plans or prices.</p>
    </header>
    {!enabled?<p className="text-sm text-muted-foreground">Growth or Scale access is required to accept recurring client payments.</p>:<>
      {query.isPending?<p className="text-sm">Loading your subscription link…</p>:query.error?
        <p role="alert" className="text-sm text-destructive">{query.error.message} <button className="underline" onClick={()=>void query.refetch()}>Try again</button></p>:<>
        {!slug?<Button type="button" onClick={()=>create.mutate()} disabled={create.isPending}>
          {create.isPending?'Generating your link…':'Create my subscription link'}</Button>:
          <div className="space-y-3 rounded-xl border border-primary/30 bg-primary-soft p-4">
            <p className="font-semibold">Your unique company subscription link</p>
            <a href={url} target="_blank" rel="noopener noreferrer" className="block break-all text-sm text-primary underline">{url}</a>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={()=>void copy()}><Copy className="mr-2 size-4"/>Copy link</Button>
              <a className="inline-flex items-center rounded-xl border border-input px-4 text-sm font-medium"
                target="_blank" rel="noopener noreferrer" href={'https://wa.me/?text='+encodeURIComponent('Build your own cleaning subscription: '+url)}>
                Share via WhatsApp</a>
            </div>
            <p className="text-xs text-muted-foreground">Send this link to clients by WhatsApp or email. They choose their own weekly schedule and price in pounds sterling.</p>
          </div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface-2 p-4"><p className="text-xs text-muted-foreground">Active subscribers</p><p className="text-2xl font-bold">{active.length}</p></div>
          <div className="rounded-xl border border-border bg-surface-2 p-4"><p className="text-xs text-muted-foreground">Projected gross MRR</p><p className="text-2xl font-bold">{gbp(mrr)}</p>
            <p className="text-xs text-muted-foreground">CleanMa fee: {gbp(Math.round(mrr/100))} (1%) · Stripe charges are separate.</p></div>
        </div>
        <div className="space-y-3">
          <h3 className="font-semibold">Custom subscription requests and subscribers</h3>
          {!subscriptions.length&&<p className="text-sm text-muted-foreground">No customers have subscribed through your link yet.</p>}
          {subscriptions.map(s=>{
            const next=query.data?.visits.find(v=>v.subscription_id===s.id&&
              ['scheduled','pending_approval'].includes(v.status)&&new Date(v.scheduled_at)>new Date());
            return <article key={s.id} className="space-y-3 rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><h4 className="font-semibold">{s.client_name}</h4><p className="break-all text-xs text-muted-foreground">{s.client_email}</p></div>
                <span className="rounded-lg bg-surface-2 px-2 py-1 text-xs font-semibold capitalize">{s.status.replaceAll('_',' ')}</span>
              </div>
              <p className="text-sm">{s.visits_per_week}×/week · {s.preferred_days.join(', ')} · {s.start_time.slice(0,5)} · <strong>{gbp(s.monthly_amount_pence)}/month</strong></p>
              <p className="text-xs text-muted-foreground">CleanMa 1%: {gbp(Math.round(s.monthly_amount_pence/100))} · Owner before Stripe fees: {gbp(s.monthly_amount_pence-Math.round(s.monthly_amount_pence/100))}</p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground"><CalendarClock className="size-3"/> Next visit: {next?new Date(next.scheduled_at).toLocaleString('en-GB',{timeZone:'Europe/London',dateStyle:'medium',timeStyle:'short'}):'Not scheduled'} · Next billing: {s.next_billing_date??'Awaiting Stripe'}</p>
              {s.scheduling_error&&<p role="alert" className="text-sm text-destructive">{s.scheduling_error}</p>}
              {s.status==='pending_approval'&&!s.owner_approved&&<div className="flex flex-wrap gap-2">
                <Button size="sm" type="button" disabled={manage.isPending} onClick={()=>operation(s.id,'accept')}><CheckCircle className="mr-1 size-4"/>Accept</Button>
                <Button size="sm" type="button" variant="outline" disabled={manage.isPending} onClick={()=>operation(s.id,'decline')}>Decline</Button>
              </div>}
              {['active','pending_approval'].includes(s.status)&&<div className="flex flex-wrap gap-2">
                <Button size="sm" type="button" variant="outline" disabled={manage.isPending} onClick={()=>operation(s.id,'skip-next')}>Pause 1 visit</Button>
                <Button size="sm" type="button" variant="outline" disabled={manage.isPending} onClick={()=>operation(s.id,'skip-week')}>Skip 1 week</Button>
                <Button size="sm" type="button" variant="outline" disabled={manage.isPending} onClick={()=>operation(s.id,'cancel')}>Cancel subscription</Button>
              </div>}
            </article>;
          })}
        </div>
      </>}
      {(notice||create.error||manage.error)&&<p role="status" className="text-sm">{create.error?.message||manage.error?.message||notice}</p>}
    </>}
  </section>;
}
