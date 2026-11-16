import {describe,expect,it,vi} from 'vitest';
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
import {allowsFeature,subscriptionSchema} from '@/lib/subscriptions';
describe('Integration plan access',()=>{
 it.each(['growth','scale','GROWTH',' Scale ',' Growth '])('allows %s in Integrations',plan=>expect(allowsFeature(plan,'integrations')).toBe(true));
 it.each(['starter','trial','','enterprise'])('rejects %s in Integrations',plan=>expect(allowsFeature(plan,'integrations')).toBe(false));
 it('normalizes RPC plan casing before validation',()=>expect(subscriptionSchema.parse({plan:' SCALE ',month:'2026-11',staffUsed:0,jobsUsed:0,staffLimit:20,jobsLimit:1000,pendingPlan:null}).plan).toBe('scale'));
});
