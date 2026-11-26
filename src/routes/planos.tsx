import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { paymentApi } from "@/lib/payment-api";
import { supabase } from "@/integrations/supabase/client";
import { ownerSignupKey, readSignupChoice } from "@/lib/owner-signup";

export const Route = createFileRoute("/planos")({ component: Plans });

const prices = {
  starter: { month: 8999, year: 92870 },
  growth: { month: 17999, year: 185750 },
  scale: { month: 29999, year: 309590 },
};
type Plan = keyof typeof prices;
type Interval = keyof (typeof prices)[Plan];
type Access = { role?: string; status?: string; active?: boolean };

const isPlan = (p: unknown): p is Plan => typeof p === "string" && Object.hasOwn(prices, p);
const isInterval = (i: unknown): i is Interval => i === "month" || i === "year";
const money = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n / 100);

function Plans() {
  const [plan, setPlan] = useState<Plan>("starter");
  const [interval, setInterval] = useState<Interval>("month");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [returned, setReturned] = useState(false);
  const [access, setAccess] = useState<Access | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const afterCheckout = query.get("checkout") === "returned";
    const urlPlan = query.get("plan");
    const urlInterval = query.get("interval");
    let alive = true;
    let timer: number | undefined;
    const pollUntil = Date.now() + 120000;
    setReturned(afterCheckout);
    setAccess(null);
    setError("");
    if (isPlan(urlPlan)) setPlan(urlPlan);
    if (isInterval(urlInterval)) setInterval(urlInterval);

    async function checkAccess(poll: boolean) {
      try {
        const result = await supabase.rpc("current_subscription_access" as never);
        if (!alive) return;
        if (result.error) throw result.error;
        const value = result.data as Access | null;
        if (value?.role && value.role !== "owner") {
          location.replace("/cleaner");
          return;
        }
        if (!value || value.role !== "owner") {
          setError("Your owner workspace is not ready. Verify your email and try again.");
          return;
        }
        setAccess(value);
        if (poll && !(value.status === "active" && value.active)) {
          if (Date.now() < pollUntil) timer = window.setTimeout(() => void checkAccess(true), 5000);
          else setError("Payment has not been confirmed yet. Check again before starting another payment.");
        }
      } catch {
        if (alive) setError("Could not verify workspace access. Please try again.");
      }
    }

    async function start() {
      try {
        const { data, error: authError } = await supabase.auth.getUser();
        if (!alive) return;
        if (!data.user) {
          if (authError && authError.name !== "AuthSessionMissingError" && authError.status !== 401 && authError.status !== 403) {
            setError("Could not verify your sign-in. Please try again.");
            return;
          }
          location.replace("/admin/login?next=" + encodeURIComponent("/planos" + location.search));
          return;
        }
        const preference = readSignupChoice(data.user.user_metadata?.[ownerSignupKey]);
        if (!isPlan(urlPlan) && isPlan(preference?.plan)) setPlan(preference.plan);
        if (!isInterval(urlInterval) && isInterval(preference?.interval)) setInterval(preference.interval);
        await checkAccess(afterCheckout);
      } catch {
        if (alive) setError("Could not verify your workspace. Please try again.");
      }
    }
    void start();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [retry]);

  async function pay() {
    if (busy || access?.role !== "owner") return;
    setBusy(true);
    setError("");
    try {
      const response = await paymentApi({ action: "checkout", plan, interval });
      location.assign(response.url);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Checkout unavailable.";
      setError(message === "CHECKOUT_PENDING"
        ? "Another Checkout link is still open. Select the same plan and billing period to resume it, or wait for it to expire."
        : message === "SUBSCRIPTION_EXISTS"
          ? "A subscription already exists. Refresh this page and try again to manage it in Stripe."
          : ["CONFIGURATION_REQUIRED", "INVALID_PRICE", "WRONG_PLATFORM_ACCOUNT"].includes(message)
            ? "Stripe billing is not configured correctly. Please contact CleanMa support."
            : message);
      setBusy(false);
    }
  }

  const paid = access?.status === "active" && access.active;
  return <main className="mx-auto max-w-xl space-y-6 p-8">
    <h1 className="text-3xl font-bold">Your CleanMa subscription</h1>
    {returned && <p role="status">{paid
      ? "Stripe payment confirmed. You can open your dashboard."
      : "Waiting for payment confirmation from Stripe. A Checkout return does not confirm payment."}</p>}
    <label className="block">Plan
      <select value={plan} onChange={e => { if (isPlan(e.target.value)) setPlan(e.target.value); }}
        className="block w-full rounded border border-border bg-card p-3">
        {Object.keys(prices).map(p => <option key={p} value={p}>{p[0]?.toUpperCase() + p.slice(1)}</option>)}
      </select>
    </label>
    <fieldset className="flex gap-5"><legend>Billing period</legend>
      <label><input type="radio" checked={interval === "month"} onChange={() => setInterval("month")} /> Monthly</label>
      <label><input type="radio" checked={interval === "year"} onChange={() => setInterval("year")} /> Annual −14%</label>
    </fieldset>
    <p className="text-3xl font-bold">{money(prices[plan][interval])} / {interval}</p>
    <button disabled={busy || !access} onClick={() => void pay()}
      className="rounded-xl bg-primary px-5 py-3 text-primary-foreground disabled:opacity-60">
      {busy ? "Opening Stripe…" : paid || access?.status === "past_due" ? "Continue to Stripe billing" : "Subscribe securely with Stripe"}
    </button>
    {error && <p role="alert" className="text-destructive">{error} {(!access || (returned && !paid)) &&
      <button type="button" className="underline" onClick={() => setRetry(n => n + 1)}>Try again</button>}</p>}
    <a href="/admin" className="block underline">Return to dashboard</a>
  </main>;
}
