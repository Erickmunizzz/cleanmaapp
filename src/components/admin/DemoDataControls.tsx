import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useAdminSession} from './AdminSession';
import {Button} from '@/components/ui/button';
import {demoWorkspace,type DemoAction} from '@/lib/demo-workspace';
export const demoQueryKey=(userId:string|undefined)=>['demo-workspace',userId] as const;
export function DemoDataControls(){
 const client=useQueryClient();
 const session=useAdminSession();
 const queryKey=demoQueryKey(session?.user.id);
 const query=useQuery({queryKey,enabled:Boolean(session),queryFn:()=>demoWorkspace('read'),retry:false});
 const action=useMutation({mutationFn:(value:DemoAction)=>demoWorkspace(value),onSuccess:(data)=>{client.setQueryData(queryKey,data);}});
 return <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
  <div><h2 className="text-sm font-semibold">Demo recording workspace</h2><p className="text-xs text-muted-foreground">Generate an isolated UK cleaning scenario for your videos.</p></div>
  <div className="flex flex-wrap gap-2">
   <Button type="button" size="sm" variant="outline" disabled={query.isPending||action.isPending} onClick={()=>action.mutate('generate')}>{action.isPending?'Please wait…':'Generate Demo Data'}</Button>
   <Button type="button" size="sm" variant="outline" disabled={query.isPending||action.isPending||!query.data} onClick={()=>action.mutate('clear')}>Clear Demo Data</Button>
   {query.data&&<Button size="sm" asChild><a href="/admin/demo">Open Demo Workspace</a></Button>}
  </div>
  {(action.error||query.error)&&<p role="alert" className="w-full text-sm text-danger">{action.error?.message||query.error?.message}</p>}
  {action.isSuccess&&<p role="status" className="w-full text-xs text-muted-foreground">{action.data?'Demo data is ready. Open the workspace to record your video.':'Demo data cleared. Your real workspace is unchanged.'}</p>}
 </section>;
}
