import {authTimeout} from '@/lib/auth-timeout';
import {roleDestination} from '@/lib/role-destination';
import {ownerLanding,ownerSignupKey,ownerSignupParameters} from '@/lib/owner-signup';
import { PasswordRecoveryLink } from '@/components/auth/PasswordRecovery';
import {AuthLegalFooter} from '@/components/legal/LegalDocuments';
import {useEffect,useState} from 'react';
import {toast} from 'sonner';
import {supabase} from '@/integrations/supabase/client';
const input = "h-10 w-full rounded-xl border border-border bg-card px-3 text-[13.5px] outline-none focus:border-primary";

export function AuthPage({role='owner'}:{role?:'owner'|'cleaner'}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [remember,setRemember]=useState(true);
  useEffect(()=>{try{setEmail(localStorage.getItem('cleanma:last-email')||'');setRemember(localStorage.getItem('cleanma:remember-email')!=='false')}catch{};if(role==='owner'&&new URLSearchParams(location.search).get('mode')==='signup')setMode('signup')},[role]);
  useEffect(()=>{
    let active=true;
    void finishSignIn(role,activeCheck).catch(reason=>{
      if(active&&new URLSearchParams(window.location.search).get('confirmed')==='1')setError(authError(reason));
    });
    function activeCheck(){return active}
    return()=>{active=false};
  },[role]);
  const [password, setPassword] = useState("");
  const [error,setError]=useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try{localStorage.setItem('cleanma:remember-email',String(remember));if(remember)localStorage.setItem('cleanma:last-email',email.trim());else localStorage.removeItem('cleanma:last-email')}catch{}
    try{
      const query=new URLSearchParams(location.search);
      const token=query.get('invite');
      const options=role==='owner'&&!token ? ownerSignupParameters(query) : {emailRedirectTo:window.location.href};
      const res=await authTimeout(mode==='signin'
        ? supabase.auth.signInWithPassword({email:email.trim(),password})
        : supabase.auth.signUp({email:email.trim(),password,options}));
      if(res.error){if(res.error.code==='invalid_credentials')throw Error('Email ou senha incorretos');throw res.error;}
      if(!res.data.session){toast.success('Check your email to confirm your account.');return;}
      if(!await finishSignIn(role))throw Error('Your account does not have an active workspace profile.');
    }catch(e){setError(authError(e));}finally{setBusy(false)}
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-3">
          <img src="/cleanma-logo.png" alt="CleanMa logo" className="h-8 w-12 shrink-0 rounded object-contain" />
          <div className="text-[17px] font-bold tracking-tight">{mode === "signin" ? (role==='owner'?"Owner sign in":"Cleaner sign in") : "Create account"}</div>
        </div>
        {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
        <input className={input} type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={input} type="password" required minLength={6} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>Remember me</label>
        <button disabled={busy} className="h-10 w-full rounded-xl bg-primary text-[13.5px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
        {mode==='signin' && <PasswordRecoveryLink role={role} />}
        {(role==='owner'||(typeof window!=='undefined'&&new URLSearchParams(window.location.search).has('invite')))&&<button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="w-full text-[12.5px] text-muted-foreground hover:text-foreground">
          {mode === "signin" ? "No account yet? Create one" : "Already have an account? Sign in"}
        </button>}
        <AuthLegalFooter />
      </form>
    </div>
  );
}


function authError(error: unknown) {
  return error instanceof Error ? error.message : (error as { message?: string } | null)?.message || 'Unable to sign in. Please try again.';
}

async function finishSignIn(role:'owner'|'cleaner', active=()=>true) {
  const {data:{session},error}=await authTimeout(supabase.auth.getSession());
  if(error)throw error;
  if(!session||!active())return false;
  const query=new URLSearchParams(location.search);
  const token=query.get('invite');
  if(token){
    const profile=await authTimeout(supabase.from('profiles').select('id').eq('id',session.user.id).maybeSingle());
    if(profile.error)throw profile.error;
    if(!profile.data){
      const result=await authTimeout(supabase.rpc('accept_staff_invite' as never,{invite_token:token} as never));
      if(result.error)throw result.error;
    }
  }
  const destination=await authTimeout(roleDestination());
  if(!active())return false;
  if(destination==='/auth'){
    if(query.get('confirmed')==='1')throw Error('Your email was confirmed but the workspace is not available. Please try signing in again.');
    return false;
  }
  if(role==='owner'&&!token&&(destination==='/admin'||destination==='/planos')){
    window.location.replace(ownerLanding(destination,query,session.user.user_metadata?.[ownerSignupKey]));
  }else{
    window.location.replace(destination);
  }
  return true;
}
