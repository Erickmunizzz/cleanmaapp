import {createFileRoute} from '@tanstack/react-router';
import {supabase} from '@/integrations/supabase/client';
export const Route=createFileRoute('/suspended')({component:()=> <main className="p-8"><h1>Workspace access suspended</h1><p>Contact your manager to renew the company subscription.</p><button type="button" className="mt-4 underline" onClick={()=>void supabase.auth.signOut({scope:'local'}).then(()=>location.replace('/cleaner/login'))}>Sign out</button></main>});
