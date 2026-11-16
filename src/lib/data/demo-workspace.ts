import {z} from 'zod';
const base={id:z.string().uuid(),key:z.string(),is_demo:z.literal(true)};
const cleaner=z.object({...base,kind:z.literal('cleaner'),data:z.object({name:z.string(),role:z.string(),status:z.string()})});
const client=z.object({...base,kind:z.literal('client'),data:z.object({name:z.string(),address:z.string(),postcode:z.string()})});
const job=z.object({...base,kind:z.literal('job'),data:z.object({client_key:z.string(),cleaner_key:z.string(),date:z.string(),start:z.string(),end:z.string(),amount_pence:z.number().int().nonnegative(),status:z.string(),archived:z.boolean()})});
const invoice=z.object({...base,kind:z.literal('invoice'),data:z.object({client_key:z.string(),job_key:z.string(),number:z.string(),date:z.string(),status:z.string(),amount_pence:z.number().int().nonnegative()})});
const payroll=z.object({...base,kind:z.literal('payroll'),data:z.object({cleaner_key:z.string(),month:z.string(),amount_pence:z.number().int().nonnegative()})});
const timeEntry=z.object({...base,kind:z.literal('time_entry'),data:z.object({cleaner_key:z.string(),date:z.string(),clock_in:z.string(),clock_out:z.string().nullable()})});
export const demoSchema=z.object({company:z.object({id:z.string().uuid(),owner_id:z.string().uuid(),name:z.string(),is_demo:z.literal(true),demo_date:z.string()}),records:z.array(z.discriminatedUnion('kind',[cleaner,client,job,invoice,payroll,timeEntry]))});
export type DemoWorkspace=z.infer<typeof demoSchema>;
export const demoMoney=(pence:number)=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(pence/100);
export function demoMetrics(workspace:DemoWorkspace){
 const today=workspace.company.demo_date;
 const date=new Date(today+'T12:00:00Z');
 date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));
 const start=date.toISOString().slice(0,10);
 const jobs=workspace.records.filter(row=>row.kind==='job');
 return {
  cleaners:workspace.records.filter(row=>row.kind==='cleaner').length,
  jobsToday:jobs.filter(row=>row.data.date===today&&!row.data.archived).length,
  completed:jobs.filter(row=>row.data.status==='Completed'&&row.data.date>=start&&row.data.date<=today).length,
  payroll:workspace.records.filter(row=>row.kind==='payroll').filter(row=>row.data.month===today.slice(0,7)).reduce((sum,row)=>sum+row.data.amount_pence,0),
  revenue:workspace.records.filter(row=>row.kind==='invoice').filter(row=>row.data.status==='Paid'&&row.data.date.startsWith(today.slice(0,7))).reduce((sum,row)=>sum+row.data.amount_pence,0),
 };
}
