import { useState, type FormEvent } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { authTimeout } from '@/lib/auth-timeout';
import { recoveryPath, recoveryReturnUrl, usePasswordRecoveryState, type RecoveryRole } from '@/lib/password-recovery';

const input = 'block h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-primary';
const button = 'h-10 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60';

export function PasswordRecoveryLink({ role }: { role: RecoveryRole }) {
  return <a className="block text-center text-[12.5px] text-muted-foreground underline hover:text-foreground" href={recoveryPath(role)}>Forgot your password?</a>;
}

export function PasswordRecoveryPage({ role }: { role: RecoveryRole }) {
  const verification = usePasswordRecoveryState();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const back = role === 'cleaner' ? '/cleaner.html' : '/admin/login';
  const ready = verification.status === 'ready';
  const checking = verification.status === 'checking';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || checking || saved) return;
    setError('');
    setSent(false);
    if (ready && (password !== repeatPassword || password.length < 12)) {
      setError('Use at least 12 characters and type the same password in both fields.');
      return;
    }
    setBusy(true);
    try {
      if (ready) {
        const current = await authTimeout(supabase.auth.getUser());
        if (current.error || current.data.user?.id !== verification.userId) {
          setError('This reset session is no longer active. Request a new link.');
          return;
        }
        const result = await authTimeout(supabase.auth.updateUser({ password }));
        if (result.error) throw result.error;
        setPassword('');
        setRepeatPassword('');
        setSaved(true);
        try { await authTimeout(supabase.auth.signOut({ scope: 'local' })); }
        catch { /* The password was already changed. */ }
      } else {
        const result = await authTimeout(supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: recoveryReturnUrl(role),
        }));
        if (result.error) throw result.error;
        setSent(true);
      }
    } catch {
      setError(ready ? 'Could not save the new password. Choose a different password or request a fresh link.' :
        'Could not request a reset email. Please try again later.');
    } finally { setBusy(false); }
  }

  return <main className="flex min-h-screen items-center justify-center bg-background p-4">
    <section className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6 shadow-card" aria-labelledby="recovery-title">
      <img src="/cleanma-logo.png" alt="CleanMa logo" className="h-8 w-12 rounded object-contain" />
      <h1 id="recovery-title" className="text-lg font-bold">{ready ? 'Set a new password' : 'Reset your password'}</h1>
      {checking && <p className="text-sm text-muted-foreground" role="status">Checking the reset link…</p>}
      {verification.status === 'invalid' && <p className="text-sm text-destructive" role="alert">This link is invalid or has expired. Request a new link below.</p>}
      {saved && <p className="text-sm" role="status">Password updated. Sign in with your new password.</p>}
      {sent && <p className="text-sm" role="status">If that email has an account, check your inbox and spam folder for a reset link.</p>}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {!checking && !saved && <form className="space-y-3" onSubmit={submit}>
        {ready ? <>
          <label className="block text-sm">New password
            <input className={input} autoComplete="new-password" type="password" minLength={12} value={password} onChange={e => setPassword(e.target.value)} required />
          </label>
          <label className="block text-sm">Confirm new password
            <input className={input} autoComplete="new-password" type="password" minLength={12} value={repeatPassword} onChange={e => setRepeatPassword(e.target.value)} required />
          </label>
        </> : <label className="block text-sm">Email
          <input className={input} autoComplete="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
        </label>}
        <button className={button} disabled={busy} type="submit">
          {busy ? 'Please wait…' : ready ? 'Save password' : 'Send reset link'}
        </button>
      </form>}
      <a className="block text-center text-sm text-muted-foreground underline hover:text-foreground" href={back}>Back to sign in</a>
    </section>
  </main>;
}
