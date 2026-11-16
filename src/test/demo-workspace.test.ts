import {describe,it,expect} from 'vitest';
import {demoMetrics,demoMoney,demoSchema,type DemoWorkspace} from '@/lib/data/demo-workspace';
const id='00000000-0000-4000-8000-000000000001';
const row={id,is_demo:true as const};
export const demo:DemoWorkspace={company:{id,owner_id:id,name:'BrightSpark Cleaning Services',is_demo:true,demo_date:'2026-11-16'},records:[
 ...['sarah','david','emma'].map(key=>({...row,key,kind:'cleaner' as const,data:{name:key,role:'Cleaner',status:'Present'}})),
 ...[0,1,2].map(i=>({...row,key:'job'+i,kind:'job' as const,data:{client_key:'1',cleaner_key:'sarah',date:'2026-11-16',start:'08:00',end:'16:00',amount_pence:45000,status:i===0?'Completed':'Scheduled',archived:false}})),
 ...Array.from({length:11},(_,i)=>({...row,key:'history'+i,kind:'job' as const,data:{client_key:'1',cleaner_key:'sarah',date:'2026-11-16',start:'06:00',end:'07:00',amount_pence:49000,status:'Completed',archived:true}})),
 { ...row,key:'salary',kind:'payroll',data:{cleaner_key:'sarah',month:'2026-11',amount_pence:340000}},
 { ...row,key:'invoice',kind:'invoice',data:{client_key:'1',job_key:'job0',number:'DEMO-1001',date:'2026-11-16',status:'Paid',amount_pence:585000}},
]};
describe('Demo workspace presentation',()=>{
 it('calculates exact requested totals from records and excludes archived jobs from today’s roster',()=>expect(demoMetrics(demoSchema.parse(demo))).toEqual({cleaners:3,jobsToday:3,completed:12,payroll:340000,revenue:585000}));
 it('rejects a real company or unmarked record',()=>{expect(()=>demoSchema.parse({...demo,company:{...demo.company,is_demo:false}})).toThrow();expect(()=>demoSchema.parse({...demo,records:[{...demo.records[0],is_demo:false}]})).toThrow()});
 it('keeps all currency in GBP',()=>expect(demoMoney(340000)).toBe('£3,400.00'));
 it('does not count future completions or unpaid invoices as earned revenue',()=>{const modified=structuredClone(demo);modified.records.push({...row,key:'future',kind:'job',data:{client_key:'1',cleaner_key:'sarah',date:'2026-11-17',start:'08:00',end:'16:00',amount_pence:100,status:'Completed',archived:false}},{...row,key:'unpaid',kind:'invoice',data:{client_key:'1',job_key:'future',number:'DEMO-UNPAID',date:'2026-11-16',status:'Unpaid',amount_pence:100000}});expect(demoMetrics(modified).completed).toBe(12);expect(demoMetrics(modified).revenue).toBe(585000)});
});
