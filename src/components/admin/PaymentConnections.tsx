import {useEffect, useState} from 'react';
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
  STRIPE_CLIENT_ID_MISSING: 'Stripe Connect is missing its Client ID. Set STRIPE_CLIENT_ID in Vercel and redeploy.',
  STRIPE_CLIENT_ID_INVALID: 'Stripe Connect Client ID is invalid. Copy the Connect Client ID (ca_…) from Stripe into STRIPE_CLIENT_ID in Vercel and redeploy.',
  STRIPE_ACCOUNT_MISMATCH: 'This account could not be verified. Select your Stripe Standard account and try again.',
  STRIPE_ACCOUNT_NOT_READY: 'Complete your Stripe onboarding before accepting payments.',
  CONFIGURATION_REQUIRED: 'The server is missing Stripe/Xero settings. Verify the Production variables in the Vercel project serving cleanmaapp.com, then redeploy.',
  INVALID_OAUTH_STATE: 'The connection expired or the browser changed domains. Start again on https://cleanmaapp.com and complete the connection in the same browser.',
  STRIPE_CLIENT_ID_MISMATCH: 'Verify that https://cleanmaapp.com/api/stripe/connect/callback is allowed as a Stripe Connect OAuth redirect URI.',
};
const errorText = (error: unknown) => error instanceof Error ? messages[error.message] ?? error.message : 'Connection failed. Please try again.';

export function PaymentConnections() {
  const [rows, setRows] = useState<Connection[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [returnNotice, setReturnNotice] = useState('');

  useEffect(() => {
    let active = true;
    const outcome = new URLSearchParams(window.location.search).get('integration');
    if (outcome === 'stripe_failed') setReturnNotice('Stripe could not be connected. Try connecting again.');
    if (outcome === 'stripe_cancelled') setReturnNotice('Stripe authorisation was cancelled.');
    const reason = new URLSearchParams(window.location.search).get('reason');
    if(reason&&messages[reason])setReturnNotice(messages[reason]);
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

  async function open(provider: string) {
    setBusy(provider);
    setError('');
    try {
      setReturnNotice('');
      const result = await paymentApi({action: 'connect', provider});
      window.location.assign(result.url);
    } catch (reason) { setError(errorText(reason)); setBusy(''); }
  }

  return <section id="payment-connections" className="space-y-4 rounded-xl border border-border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">Payment &amp; Accounting Connections</h3>
      <Button type="button" variant="ghost" disabled={loading || !!busy} onClick={() => void refreshStatus()}>Check status</Button>
    </div>
    {['stripe', 'xero'].map(provider => {
      const row = rows.find(connection => connection.provider === provider);
      const stripe = provider === 'stripe';
      const status = loading ? 'Checking connection…' : !row?.connected ? 'Not connected' : stripe
        ? 'Connected'
        : row.account_id ? 'Connected · ' + row.account_id : 'Authorised · tenant selection required';
      return <div key={provider} className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <strong>{stripe ? 'Stripe Connect Standard' : 'Xero'}</strong>
          <p className="text-muted-foreground" role="status">{status}</p>
          {stripe && row?.account_id && <p className="text-xs text-muted-foreground">{row.account_id}</p>}
          {stripe && row?.status_unavailable && <p className="text-xs text-muted-foreground">Could not check payment readiness with Stripe.</p>}
          {stripe && row?.connected && !row.status_unavailable && <p className="text-xs text-muted-foreground">
            Payments: {row.charges_enabled ? 'enabled' : 'not enabled'} · Details: {row.details_submitted ? 'submitted' : 'required'} · Payouts: {row.payouts_enabled ? 'enabled' : 'not enabled'}
          </p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={loading || !!busy} onClick={() => void open(provider)}>
            {busy === provider ? 'Opening…' : stripe ? row?.connected ? 'Reconnect Stripe' : 'Connect Stripe' : 'Connect Xero'}
          </Button>
        </div>
      </div>;
    })}
    <p className="text-xs text-muted-foreground">The Stripe button opens Stripe's authorisation first and returns to <code>/api/stripe/connect/callback</code>. Xero authorisation returns to <code>/api/xero/callback</code>. Both callbacks must be registered with the respective provider.</p>
    <p className="text-xs text-muted-foreground">Stripe collection links retain a 1% CleanMa platform fee; Stripe processing fees are separate. Xero authorisation stores credentials for future accounting sync; it does not send invoices automatically.</p>
    {returnNotice && <p role="status" className="text-sm">{returnNotice}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
