import {useQuery} from '@tanstack/react-query';
import {useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {useAdminSession} from './AdminSession';
type Subscriber={id:string;email:string;status:string;consented_at:string;created_at:string;source:string};
type Page={total:number;items:Subscriber[]};
export function NewsletterLeads(){
 const session=useAdminSession(),[page,setPage]=useState(0);
 const access=useQuery({queryKey:['marketing-access',session?.user.id],enabled:Boolean(session),queryFn:async()=>{const r=await supabase.rpc('marketing_admin_access' as never);if(r.error)throw new Error('Marketing access is not configured.');return Boolean(r.data);}});
 const query=useQuery({queryKey:['newsletter-subscribers',session?.user.id,page],enabled:Boolean(access.data),queryFn:async()=>{const r=await supabase.rpc('marketing_subscribers' as never,{page_input:page} as never);if(r.error)throw new Error('Could not load subscribers.');return r.data as unknown as Page;}});
 const data=query.data;
 function download(){if(!data)return;const escape=(s:string)=>'"'+(/^[=+\-@\t\r]/.test(s)?"'"+s:s).replaceAll('"','""')+'"';const csv='email,status,consented_at,source\r\n'+data.items.map(r=>[r.email,r.status,r.consented_at,r.source].map(escape).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download=`cleanma-subscribers-page-${page+1}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 if(access.isPending)return <p role="status">Checking marketing access…</p>;
 if(access.isError)return <p role="alert">{access.error.message}</p>;
 if(!access.data)return <p role="alert">This page is restricted to the CleanMa marketing administrator.</p>;
 return <section className="space-y-5"><h1 className="text-2xl font-bold">Newsletter subscribers</h1><p className="text-sm text-muted-foreground">Contacts collected with marketing consent on the CleanMa landing page. No campaign is sent automatically.</p>
 {query.isPending?<p role="status">Loading subscribers…</p>:query.isError?<div role="alert">{query.error.message}<button className="ml-3 underline" onClick={()=>void query.refetch()}>Retry</button></div>:data&&<><div className="flex flex-wrap items-center justify-between gap-4"><p>{data.total} contact(s)</p><button disabled={!data.items.length} onClick={download} className="rounded border border-border px-4 py-2 disabled:opacity-50">Export this page (CSV)</button></div><div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border"><th className="p-3">Email</th><th className="p-3">Status</th><th className="p-3">Consent date</th><th className="p-3">Source</th></tr></thead><tbody>{data.items.length?data.items.map(row=><tr key={row.id} className="border-b border-border"><td className="p-3">{row.email}</td><td className="p-3">{row.status}</td><td className="p-3">{new Date(row.consented_at).toLocaleDateString('en-GB')}</td><td className="p-3">{row.source}</td></tr>):<tr><td colSpan={4} className="p-6">No subscribers yet.</td></tr>}</tbody></table></div><div className="flex items-center gap-5"><button disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page+1}</span><button disabled={(page+1)*50>=data.total} onClick={()=>setPage(p=>p+1)}>Next</button></div></>}
 </section>;
}
