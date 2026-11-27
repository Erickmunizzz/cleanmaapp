import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Check, Star } from "lucide-react";
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

const plans = {
  starter: {
    name: "Starter",
    description: "For small cleaning businesses getting started.",
    features: [
      "Up to 5 staff members",
      "Smart job scheduling & calendar dispatch",
      "Client & cleaner mobile apps (iOS & Android)",
      "Real-time GPS clock-in & check-out",
      "Automated email notifications & history*",
      "Basic financial & hours reporting",
    ],
  },
  growth: {
    name: "Growth",
    description: "For growing cleaning teams.",
    features: [
      "Up to 12 staff members",
      "Everything in Starter, plus:",
      "Payments via QR code with Stripe Connect",
      "Live job issue reporting with photo proof",
      "Smart inventory & cleaning materials tracker",
      "Built-in team chat & time-off management",
      "Priority support & faster sync times",
    ],
  },
  scale: {
    name: "Scale",
    description: "For teams managing multiple locations.",
    features: [
      "Up to 20 staff members",
      "Everything in Starter & Growth, plus:",
      "Multi-location branch & team management",
      "Advanced digital cleaning checklists & quality audits",
      "Comprehensive revenue & payroll analytics",
      "Custom workflow automations",
      "Dedicated VIP account manager",
    ],
  },
} satisfies Record<Plan, { name: string; description: string; features: string[] }>;
const planOrder = ["starter", "growth", "scale"] as const;

const isPlan = (p: unknown): p is Plan => typeof p === "string" && Object.hasOwn(prices, p);
const isInterval = (i: unknown): i is Interval => i === "month" || i === "year";
const money = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n / 100);

export function Plans() {
  const [preferredPlan, setPreferredPlan] = useState<Plan | null>(null);
  const [interval, setInterval] = useState<Interval>("month");
  const [busy, setBusy] = useState<Plan | null>(null);
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
    if (isPlan(urlPlan)) setPreferredPlan(urlPlan);
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
        if (!isPlan(urlPlan) && isPlan(preference?.plan)) setPreferredPlan(preference.plan);
        if (!isInterval(urlInterval) && isInterval(preference?.interval)) setInterval(preference.interval);
        await checkAccess(afterCheckout);
      } catch {
        if (alive) setError("Could not verify your workspace. Please try again.");
      }
    }
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setBusy(null);
    }
    window.addEventListener("pageshow", onPageShow);
    void start();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [retry]);

  async function openStripe(action: Plan) {
    if (busy || access?.role !== "owner") return;
    setBusy(action);
    setError("");
    let navigating = false;
    try {
      const response = await paymentApi({ action: "checkout", plan: action, interval });
      location.assign(response.url);
      navigating = true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Checkout unavailable.";
      setError(message === "CHECKOUT_PROCESSING"
        ? "Your payment is being confirmed. Check your access before starting another payment."
        : ["CHECKOUT_RETRY", "CHECKOUT_PENDING"].includes(message)
          ? "Checkout is updating. Please choose your plan again."
          : message === "SUBSCRIPTION_EXISTS"
            ? "A subscription already exists. Refresh this page and try again to manage it in Stripe."
            : ["CONFIGURATION_REQUIRED", "INVALID_PRICE", "WRONG_PLATFORM_ACCOUNT"].includes(message)
              ? "Stripe billing is not configured correctly. Please contact CleanMa support."
              : message);
    } finally {
      if (!navigating) setBusy(null);
    }
  }

  const paid = access?.status === "active" && access.active;
  const buttonBase = "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-950 sm:px-6 sm:py-14">
      <div className="mx-auto max-w-6xl">
        <header className="mx-auto mb-9 max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">Plans</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Your CleanMa subscription</h1>
          <p className="mt-3 text-sm text-slate-600 sm:text-base">Choose a plan for the next stage of your cleaning business.</p>
        </header>

        <div className="mb-10 flex justify-center">
          <div role="group" aria-label="Billing period" className="inline-flex gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
            {(["month", "year"] as const).map(period => (
              <button key={period} type="button" aria-pressed={interval === period} disabled={!!busy}
                onClick={() => setInterval(period)}
                className={`min-h-10 rounded-xl px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 sm:px-6 ${interval === period ? "bg-blue-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                {period === "month" ? "Monthly" : <>Annual <span className="ml-1 text-xs">-14%</span></>}
              </button>
            ))}
          </div>
        </div>

        {returned && <p role="status" className="mb-5 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">{paid
          ? "Your workspace has active access. You can return to your dashboard."
          : "Waiting for payment confirmation from Stripe. A Checkout return does not confirm payment."}</p>}
        <div className="grid gap-x-5 gap-y-8 md:grid-cols-3">
          {planOrder.map(key => {
            const { name, description, features } = plans[key];
            const price = prices[key];
            const featured = key === "growth";

            return (
              <article key={key} aria-labelledby={`plan-${key}`} className={`relative flex min-w-0 flex-col rounded-2xl border bg-white p-5 shadow-sm lg:p-7 ${featured ? "border-blue-600 ring-1 ring-blue-600" : "border-slate-200"}`}>
                {featured && <span className="absolute -top-3.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white">
                  <Star aria-hidden="true" className="size-3 fill-current" /> Most popular
                </span>}
                <h2 id={`plan-${key}`} className="text-xs font-bold uppercase tracking-widest text-slate-600">{name}</h2>
                {preferredPlan === key && <p className="mt-1 text-xs font-medium text-blue-700">Your selected plan</p>}
                {interval === "year" && <p className="mt-2 text-sm text-slate-500"><s>{money(price.month * 12)}</s></p>}
                <p className="mt-2 text-4xl font-bold tracking-tight tabular-nums lg:text-5xl">{money(price[interval])}</p>
                <p className="mt-1 text-sm text-slate-500">/ {interval === "year" ? "year" : "month"}</p>
                {interval === "year" && <p className="mt-2 text-xs font-medium text-blue-700">{money(Math.round(price.year / 12))} / month · Save {money(price.month * 12 - price.year)}</p>}
                <p className="mt-4 border-b border-slate-200 pb-5 text-sm text-slate-600">{description}</p>
                <ul className="mb-6 mt-5 space-y-3 text-sm text-slate-700">
                  {features.map(feature => <li key={feature} className="flex items-start gap-2">
                    <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded bg-blue-50 text-blue-700"><Check className="size-3" aria-hidden="true" /></span>
                    <span>{feature}</span>
                  </li>)}
                </ul>
                <button type="button" disabled={!!busy || !access} onClick={() => void openStripe(key)}
                  aria-label={busy === key ? `Opening Stripe for ${name}` : `Choose ${name} plan`}
                  className={`${buttonBase} mt-auto ${featured ? "border-blue-700 bg-blue-700 text-white hover:bg-blue-800" : "border-slate-300 bg-white text-slate-900 hover:bg-slate-100"}`}>
                  {busy === key ? "Opening Stripe…" : "Choose plan"}
                  {featured && <ArrowRight aria-hidden="true" className="size-4" />}
                </button>
              </article>
            );
          })}
        </div>

        {error && <p role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{error}{" "}
          <button type="button" className="font-semibold underline" onClick={() => setRetry(n => n + 1)}>Check again</button>
        </p>}
        <p className="mt-5 text-center text-xs text-slate-600">* Automated operational emails are not yet available.</p>
        <p className="mt-2 text-center text-xs text-slate-600">Existing Stripe subscriptions are managed in the Stripe billing portal.</p>
        <a href="/admin" className="mx-auto mt-5 block w-fit text-sm font-medium text-slate-600 underline underline-offset-4">Return to dashboard</a>
      </div>
    </main>
  );
}
