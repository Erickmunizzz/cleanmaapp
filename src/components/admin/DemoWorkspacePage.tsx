import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Users,Briefcase,ClipboardCheck,PoundSterling,Wallet} from 'lucide-react';
import {useAdminSession} from './AdminSession';
import {DemoDataControls,demoQueryKey} from './DemoDataControls';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {demoWorkspace} from '@/lib/demo-workspace';
import {demoMetrics,demoMoney} from '@/lib/data/demo-workspace';

export function DemoWorkspacePage(){
 const session=useAdminSession();
 const queryKey=demoQueryKey(session?.user.id);
 const query=useQuery({queryKey,queryFn:()=>demoWorkspace('read'),enabled:Boolean(session),retry:false});
 const client=useQueryClient();
 const [view,setView]=useState<'admin'|'cleaner'>('admin');
 const clock=useMutation({mutationFn:(action:'clock_in'|'clock_out')=>demoWorkspace(action),onSuccess:data=>client.setQueryData(queryKey,data)});
 const demo=query.data;
 if(query.isPending)return <p role="status" className="p-6 text-muted-foreground">Loading demo workspace…</p>;
 if(query.error)return <div role="alert" className="space-y-3 p-6"><p>{query.error.message}</p><Button variant="outline" onClick={()=>void query.refetch()}>Try again</Button></div>;
 if(!demo)return <div className="space-y-6"><h1 className="text-[26px] font-bold">Demo Workspace</h1><DemoDataControls/><p className="text-sm text-muted-foreground">Generate Demo Data to open BrightSpark Cleaning Services.</p><a className="text-primary underline" href="/admin/settings">Back to Settings</a></div>;
 const metrics=demoMetrics(demo);
 const cleaners=demo.records.filter(row=>row.kind==='cleaner');
 const clients=demo.records.filter(row=>row.kind==='client');
 const jobs=demo.records.filter(row=>row.kind==='job');
 const entries=demo.records.filter(row=>row.kind==='time_entry');
 const invoices=demo.records.filter(row=>row.kind==='invoice');
 const open=entries.find(row=>row.data.cleaner_key==='sarah'&&row.data.clock_out===null);
 const clientFor=(key:string)=>clients.find(row=>row.key===key)?.data;
 const cleanerFor=(key:string)=>cleaners.find(row=>row.key===key)?.data;
 const todayJobs=jobs.filter(row=>!row.data.archived&&row.data.date===demo.company.demo_date);
 const weekly=jobs.filter(row=>!row.data.archived&&row.data.cleaner_key==='sarah').sort((a,b)=>(a.data.date+a.data.start).localeCompare(b.data.date+b.data.start));
 const cards=[{label:'Total Cleaners',value:String(metrics.cleaners),icon:Users},{label:'Active Jobs Today',value:String(metrics.jobsToday),icon:Briefcase},{label:'Completed This Week',value:String(metrics.completed),icon:ClipboardCheck},{label:'Monthly Payroll',value:demoMoney(metrics.payroll),icon:Wallet},{label:'Monthly Revenue',value:demoMoney(metrics.revenue),icon:PoundSterling}];
 return <div className="mx-auto max-w-[1400px] space-y-6">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-wide text-primary">Demo workspace · UK · GBP</p><h1 className="text-[26px] font-bold">{demo.company.name}</h1><p className="text-xs text-muted-foreground">Scenario date: {demo.company.demo_date} · Europe/London</p></div><a href="/admin/settings" className="text-sm text-primary underline">Return to Settings</a></div>
  <DemoDataControls/>
  <nav aria-label="Demo view" className="flex gap-2"><Button variant={view==='admin'?'default':'outline'} onClick={()=>setView('admin')}>Admin Dashboard</Button><Button variant={view==='cleaner'?'default':'outline'} onClick={()=>setView('cleaner')}>Preview Sarah’s App</Button></nav>
  {view==='admin'?<>
   <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{cards.map(({label,value,icon:Icon})=><Card key={label} className="rounded-xl border-border bg-card shadow-none"><CardContent className="space-y-3 p-5"><Icon className="size-5 text-primary"/><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-bold">{value}</p></CardContent></Card>)}</div>
   <Card><CardHeader><CardTitle>Today’s Cleaning Jobs</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow>{['Client & Property','Cleaner','Time','Value','Status'].map(title=><TableHead key={title}>{title}</TableHead>)}</TableRow></TableHeader><TableBody>{todayJobs.map(row=><TableRow key={row.id}><TableCell><p className="font-medium">{clientFor(row.data.client_key)?.name}</p><p className="text-xs text-muted-foreground">{clientFor(row.data.client_key)?.address} · {clientFor(row.data.client_key)?.postcode}</p></TableCell><TableCell>{cleanerFor(row.data.cleaner_key)?.name}</TableCell><TableCell>{row.data.start} – {row.data.end}</TableCell><TableCell>{demoMoney(row.data.amount_pence)}</TableCell><TableCell><span className="rounded-full bg-primary-soft px-2 py-1 text-xs text-primary">{row.data.status}</span></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
   <Card><CardHeader><CardTitle>Team Attendance</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow>{['Cleaner','Role','Status','Check-in','Check-out'].map(title=><TableHead key={title}>{title}</TableHead>)}</TableRow></TableHeader><TableBody>{cleaners.map(row=>{const shift=entries.find(entry=>entry.data.cleaner_key===row.key&&entry.key.endsWith('-shift'));return <TableRow key={row.id}><TableCell className="font-medium">{row.data.name}</TableCell><TableCell>{row.data.role}</TableCell><TableCell>{row.data.status}</TableCell><TableCell>{shift?.data.clock_in??'—'}</TableCell><TableCell>{shift?.data.clock_out??'—'}</TableCell></TableRow>})}</TableBody></Table></CardContent></Card>
   <Card><CardHeader><CardTitle>Paid Invoices This Month</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow>{['Invoice','Customer','Date','Amount','Status'].map(title=><TableHead key={title}>{title}</TableHead>)}</TableRow></TableHeader><TableBody>{invoices.map(row=><TableRow key={row.id}><TableCell>{row.data.number}</TableCell><TableCell>{clientFor(row.data.client_key)?.name}</TableCell><TableCell>{row.data.date}</TableCell><TableCell>{demoMoney(row.data.amount_pence)}</TableCell><TableCell>{row.data.status}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
  </>:<div className="mx-auto max-w-[440px] space-y-4 rounded-2xl border border-border bg-background p-4 shadow-sm">
   <div className="rounded-xl bg-card p-4"><p className="text-xs text-primary">Cleaner app preview</p><h2 className="text-xl font-bold">Sarah Jenkins</h2><p className="text-sm text-muted-foreground">Senior Cleaner · BrightSpark Cleaning Services</p></div>
   <Card><CardContent className="space-y-4 p-5"><p role="status" className="font-medium">{open?'You are clocked in':'Ready for your next shift'}</p><Button className="w-full" disabled={clock.isPending} onClick={()=>clock.mutate(open?'clock_out':'clock_in')}>{clock.isPending?'Saving…':open?'Clock Out':'Clock In'}</Button>{clock.error&&<p role="alert" className="text-sm text-danger">{clock.error.message}</p>}<p className="text-xs text-muted-foreground">Demo clock only · Times shown in Europe/London</p></CardContent></Card>
   <h3 className="font-semibold">Weekly Cleaning Schedule</h3>{weekly.map(row=><Card key={row.id}><CardContent className="space-y-2 p-4"><p className="text-xs font-medium text-primary">{row.data.date} · {row.data.start} – {row.data.end}</p><p className="font-semibold">{clientFor(row.data.client_key)?.name}</p><p className="text-sm text-muted-foreground">{clientFor(row.data.client_key)?.address}</p><p className="text-sm">Postcode: {clientFor(row.data.client_key)?.postcode}</p><p className="text-xs text-muted-foreground">{row.data.status}</p></CardContent></Card>)}
  </div>}
 </div>;
}
