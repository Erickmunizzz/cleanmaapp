import {supabase} from '@/integrations/supabase/client';
import {demoSchema} from '@/lib/data/demo-workspace';
export type DemoAction='read'|'generate'|'clear'|'clock_in'|'clock_out';
export async function demoWorkspace(action:DemoAction){
 const result=await supabase.rpc('cleanma_demo_workspace',{action});
 if(result.error)throw new Error(result.error.message);
 return result.data===null?null:demoSchema.parse(result.data);
}
