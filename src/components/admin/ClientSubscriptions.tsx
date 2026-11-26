import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Repeat2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { paymentApi } from "@/lib/payment-api";
import { readAllRows } from "@/lib/supabase-pages";
import { supabase } from "@/integrations/supabase/client";
import { StripeSetupNotice, type StripeReadiness } from "./PaymentConnections";

const messages: Record<string, string> = {
  CLIENT_SUBSCRIPTIONS_DISABLED: "Recurring checkout is not enabled for this environment.",
  CLIENT_NOT_AVAILABLE: "Select an active client from your workspace.",
  STRIPE_ACCOUNT_MISMATCH: "Verify the connected account in Payment & Accounting Connections.",
  INVALID_REQUEST: "Check the client, billing period, amount and description.",
};
const amountFormat = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const selectClass = "h-10 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-sm";

export function ClientSubscriptions({ companyId, canUse, stripeReadiness = "unknown" }: { companyId: string; canUse: boolean; stripeReadiness?: StripeReadiness }) {
  const options = useQuery({
    queryKey: ["client-subscription-options", companyId],
    queryFn: () => paymentApi<{ enabled: boolean }>({ action: "client-subscription-options" }),
    enabled: canUse,
  });
  const enabled = canUse && options.data?.enabled === true;
  const stripeBlocked = stripeReadiness === "not-connected" || stripeReadiness === "needs-onboarding";
  const clients = useQuery({
    queryKey: ["payment-customers", companyId],
    queryFn: () => readAllRows((a, b) => supabase.from("clients").select("id,name")
      .eq("company_id", companyId).eq("is_archived", false).order("name").order("id").range(a, b)),
    enabled: enabled && !stripeBlocked,
  });
  const [client, setClient] = useState("");
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pence = /^\d{1,7}(\.\d{1,2})?$/.test(amount) ? Math.round(Number(amount) * 100) : 0;
  const valid = pence >= 100 && pence <= 100_000_000;

  function edited() {
    setRequestId(crypto.randomUUID());
    setUrl("");
    setNotice("");
    setError("");
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || stripeBlocked || !valid || !client || !description.trim() || busy || url) return;
    setBusy(true);
    setError("");
    try {
      const result = await paymentApi({
        action: "client-subscription-link", client_id: client,
        request_id: requestId, amount: pence, description, interval,
      });
      setUrl(result.url);
    } catch (reason) {
      setError(reason instanceof Error ? messages[reason.message] ?? reason.message : "Could not create the link. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="min-w-0 space-y-4 rounded-2xl border border-border bg-card p-5 shadow-card" aria-labelledby="client-subscriptions-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h2 id="client-subscriptions-title" className="flex items-center gap-2 text-lg font-semibold">
          <Repeat2 aria-hidden="true" className="size-5 text-primary" /> Client subscriptions
        </h2>
        <p className="text-sm text-muted-foreground">Send a Stripe Checkout link. Your client enters their own billing address and payment details. Share each link privately with one client.</p>
      </div>
      <span className="rounded-full border border-border bg-surface-2 px-3 py-1 text-xs font-semibold">1% CleanMa fee per paid invoice</span>
    </div>
    {!canUse ? <p className="text-sm text-muted-foreground">Available on Growth and Scale.</p>
      : options.isPending ? <p role="status" className="text-sm text-muted-foreground">Checking recurring checkout…</p>
      : options.isError ? <p role="alert" className="text-sm text-destructive">Could not verify recurring checkout. <button type="button" className="underline" onClick={() => void options.refetch()}>Try again</button></p>
      : stripeBlocked ? <StripeSetupNotice readiness={stripeReadiness} />
      : !enabled ? <p className="rounded-xl border border-border bg-surface-2 p-3 text-sm text-muted-foreground">Recurring checkout is not enabled yet. To send a one-time payment link, use Collect from Client above.</p>
      : <form onSubmit={create} className="space-y-3">
        <fieldset disabled={busy} className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          <label className="grid min-w-0 gap-1 text-sm font-medium">Client
            <select className={selectClass} value={client} required onChange={e => { setClient(e.target.value); edited(); }}>
              <option value="">{clients.isPending ? "Loading clients…" : "Select client"}</option>
              {clients.data?.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <label className="grid min-w-0 gap-1 text-sm font-medium">Amount (GBP)
            <Input className="w-full min-w-0" type="number" inputMode="decimal" min="1" max="1000000" step="0.01" value={amount} required
              placeholder="0.00" onChange={e => { setAmount(e.target.value); edited(); }} />
          </label>
          <label className="grid min-w-0 gap-1 text-sm font-medium">Billing period
            <select className={selectClass} value={interval} onChange={e => { setInterval(e.target.value === "year" ? "year" : "month"); edited(); }}>
              <option value="month">Monthly</option><option value="year">Yearly</option>
            </select>
          </label>
          <label className="grid min-w-0 gap-1 text-sm font-medium">Service description
            <Input className="w-full min-w-0" value={description} required maxLength={200}
              placeholder="Office cleaning" onChange={e => { setDescription(e.target.value); edited(); }} />
          </label>
        </fieldset>
        {clients.isError && <p role="alert" className="text-sm text-destructive">Could not load your clients. <button type="button" className="underline" onClick={() => void clients.refetch()}>Try again</button></p>}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 p-3">
          <p className="text-sm text-muted-foreground">{valid ? `${amountFormat.format(pence / 100)} per ${interval}. ` : ""}Stripe processing fees are separate.</p>
          <Button type="submit" disabled={busy || !client || !valid || !description.trim() || !!url}>{busy ? "Creating link…" : url ? "Link ready" : "Create subscription link"}</Button>
        </div>
        {error === "CONNECT_STRIPE_FIRST" || error === "STRIPE_ACCOUNT_NOT_READY"
          ? <StripeSetupNotice readiness={error === "CONNECT_STRIPE_FIRST" ? "not-connected" : "needs-onboarding"} />
          : error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </form>}
    {enabled && url && <div className="space-y-2 rounded-xl border border-border p-3">
      <a href={url} className="inline-flex items-center gap-2 text-sm text-primary underline" target="_blank" rel="noreferrer">Open client checkout <ExternalLink aria-hidden="true" className="size-4" /></a>
      <Input aria-label="Client checkout link" readOnly value={url} onFocus={e => e.currentTarget.select()} />
      <Button type="button" variant="outline" size="sm" onClick={async () => {
        try { await navigator.clipboard.writeText(url); setNotice("Link copied."); }
        catch { setNotice("Select and copy the link above."); }
      }}>Copy link</Button>
      <p role="status" className="text-sm text-muted-foreground">{notice}</p>
    </div>}
    <p className="text-xs text-muted-foreground">Check payments, renewals and cancellations in your connected Stripe Dashboard. Opening the link does not confirm payment.</p>
  </section>;
}
