import {useEffect, useRef, useState} from 'react';
import {paymentApi} from '@/lib/payment-api';
import {Button} from '@/components/ui/button';

type Connection = {
  provider: string;
  account_id: string | null;
  connected: boolean;
  charges_enabled?: boolean;
  details_submitted?: boolean;
  payouts_enabled?: boolean;
  status_unavailable?: boolean;
};
const messages: Record<string, string> = {
  STRIPE_SETUP_NEEDS_REVIEW: 'Stripe setup needs a support review before retrying. Please contact support.',
  STRIPE_ACCOUNT_MISMATCH: 'This Stripe account cannot be used with Express. Please contact support.',
  STRIPE_ACCOUNT_NOT_READY: 'Complete your Stripe onboarding before accepting payments.',
};
const errorText = (error: unknown) => error instanceof Error ? messages[error.message] ?? error.message : 'Connection failed. Please try again.';

export function PaymentConnections() {
  const [rows, setRows] = useState<Connection[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const refreshRequest = useRef<Promise<{url: string}> | null>(null);

  useEffect(() => {
    let active = true;
    if (new URLSearchParams(window.location.search).get('integration') === 'stripe_refresh') {
      setBusy('stripe');
      // Reuse the same request during React effect replay; never cache the one-time URL.
      refreshRequest.current ??= paymentApi({action: 'connect', provider: 'stripe'});
      void refreshRequest.current.then(result => {
        if (active) window.location.assign(result.url);
      }).catch(reason => {
        if (active) { setError(errorText(reason)); setBusy(''); }
      });
    }
    void paymentApi<Connection[]>({action: 'status'}).then(result => {
      if (active) setRows(result);
    }).catch(reason => {
      if (active) setError(errorText(reason));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function refreshStatus() {
    setLoading(true);
    setError('');
    try { setRows(await paymentApi<Connection[]>({action: 'status'})); }
    catch (reason) { setError(errorText(reason)); }
    finally { setLoading(false); }
  }

  async function open(provider: string, dashboard = false) {
    setBusy(provider);
    setError('');
    try {
      const result = await paymentApi({action: dashboard ? 'express-dashboard' : 'connect', provider});
      window.location.assign(result.url);
    } catch (reason) { setError(errorText(reason)); setBusy(''); }
  }

  return <section className="space-y-4 rounded-xl border border-border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">Payment &amp; Accounting Connections</h3>
      <Button type="button" variant="ghost" disabled={loading || !!busy} onClick={() => void refreshStatus()}>Check status</Button>
    </div>
    {['stripe', 'xero'].map(provider => {
      const row = rows.find(connection => connection.provider === provider);
      const stripe = provider === 'stripe';
      const ready = stripe && row?.charges_enabled && row.details_submitted && !row.status_unavailable;
      const status = loading ? 'Checking connection…' : !row?.connected ? 'Not connected' : stripe
        ? row.status_unavailable ? 'Stripe status unavailable. Please try again.' : ready ? 'Ready to accept payments' : row.details_submitted ? 'Verification pending or more information required' : 'Onboarding incomplete'
        : row.account_id ? 'Connected · ' + row.account_id : 'Authorised · tenant selection required';
      return <div key={provider} className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <strong>{stripe ? 'Stripe Connect Express' : 'Xero'}</strong>
          <p className="text-muted-foreground" role="status">{status}</p>
          {stripe && row?.account_id && <p className="text-xs text-muted-foreground">{row.account_id}</p>}
          {stripe && row?.connected && !row.status_unavailable && <p className="text-xs text-muted-foreground">
            Payments: {row.charges_enabled ? 'enabled' : 'not enabled'} · Details: {row.details_submitted ? 'submitted' : 'required'} · Payouts: {row.payouts_enabled ? 'enabled' : 'not enabled'}
          </p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {ready && <Button type="button" variant="outline" disabled={loading || !!busy} onClick={() => void open(provider, true)}>Open Express Dashboard</Button>}
          <Button type="button" variant="outline" disabled={loading || !!busy || !!row?.status_unavailable} onClick={() => void open(provider)}>
            {busy === provider ? 'Opening…' : stripe ? row?.connected ? ready ? 'Update Stripe details' : 'Continue Stripe setup' : 'Connect Stripe' : 'Connect Xero'}
          </Button>
        </div>
      </div>;
    })}
    <p className="text-xs text-muted-foreground">Stripe collection links retain a 1% CleanMa platform fee; Stripe processing fees are separate. Xero authorisation stores credentials for future accounting sync; it does not send invoices automatically.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
