# Client Monthly Subscriptions — deployment and verification

This implementation is additive and lives in `feature/subscription-plans`. It does
not replace CleanMa's own 14-day trial, paywall, auth, or SaaS billing webhook.

## Before publishing

1. Apply migrations to a **staging** Supabase project first. Because this
   branch builds on `feature/trial-block`, first ensure
   `supabase/migrations/20261125035033_company_trial_status_and_stripe_sync.sql`
   is installed, then apply
   `supabase/migrations/20261125041316_owner_client_recurring_subscriptions.sql`.
   The latter creates five new tables and three service-role-only functions;
   it does not alter existing tables.
2. Set the app's server-side Vercel variables on the project `cleanmaapp`:
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `STRIPE_SECRET_KEY`, `STRIPE_PLATFORM_ACCOUNT_ID`, `STRIPE_CLIENT_ID`,
   `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`,
   `PAYMENT_TOKEN_ENCRYPTION_KEY`, `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`.
   Use separate Stripe sandbox and production secrets; never paste keys into Git.
3. In Stripe Connect, allow the redirect URI
   `https://cleanmaapp.com/api/stripe/connect/callback`. The **Connect Stripe**
   button first opens `connect.stripe.com/oauth/authorize`; the callback is its
   return URL. Xero needs `https://cleanmaapp.com/api/xero/callback` in Xero's app.
4. Register a **connected-accounts** webhook (not just platform events) with
   `https://cleanmaapp.com/api/client-subscriptions-webhook` and use its signing
   secret as `STRIPE_CONNECT_WEBHOOK_SECRET`. Listen to Checkout completed/
   asynchronous success/failure, customer.subscription created/updated/deleted/
   paused/resumed, invoice paid/payment_failed/payment_action_required,
   charge.refunded, charge.dispute.created and radar.early_fraud_warning.created.
   The original `api/stripe-webhook` and its secret remain separate.
5. The landing Vercel project `clean-app-landig` currently proxies to
   `cleanmaapp-f2qq.vercel.app`, which does **not** have the Stripe/Supabase/Xero
   environment variables. In the companion Git branch
   `feature/subscription-plans` of `Erickmunizzz/clean-app-landig-`, the only
   changed file is `vercel.json`: the app/API paths are routed to the configured
   `cleanmaapp-erick-bae5.vercel.app` project. Deploy that proxy change only
   after the app project is ready, so `cleanmaapp.com` stays the canonical domain.
6. Verify the platform and connected Stripe accounts support the intended
   country/currency and settlement setup before collecting real funds. Decide
   on VAT/Stripe Tax registrations before enabling automated tax.

## End-to-end checks in a sandbox

1. Open `https://cleanmaapp.com/admin/payments` (or select Payments in the
   sidebar). Connect Stripe and confirm the OAuth return, then connect Xero and
   confirm its separate callback. Check Vercel runtime logs for a missing variable
   name if `CONFIGURATION_REQUIRED` persists. No secret values are logged.
2. In **Collect from Client**, choose a client, set an amount, and generate a
   Stripe Checkout URL + QR. Confirm the Client dropdown no longer overlaps
   Amount (GBP). If Stripe is disconnected, use the inline Connect Stripe button.
3. Under **Client Monthly Subscriptions**, select a quick template or **Create
   new plan**, enter the GBP monthly price, fixed weekday/time, and save. Copy
   the `/subscribe/<plan-id>` link.
4. Open the public link in a private browser session; enter name, email, phone
   and pay through the connected account's Stripe Checkout in sandbox mode.
   The price is always read from the saved plan, never from the public request.
   In Stripe, verify the subscription's `application_fee_percent` is 1 and that
   the connected merchant pays Stripe's processing fee separately.
5. Send/observe the signed connected-account webhook. Only after payment is
   verified should the subscription become `active`. In **Scheduling**, verify
   upcoming `scheduled` jobs were created and linked to the subscription. The
   generation is idempotent and maintains a rolling four-month calendar; paid
   renewals extend it. All job times use Europe/London.
6. Press **Skip next clean**. Only the earliest future clean is marked `skipped`
   and its corresponding job becomes `canceled`. Confirm later appointments
   remain scheduled and the Stripe subscription remains active.
7. Pause, resume and cancel through the Admin list. Confirm Stripe's state and
   future job state are synchronized by the connected webhook. Trigger a test
   invoice failure and confirm `past_due` plus an owner-visible Payment alert.
8. Verify the blue CM mark in the Admin/cleaner sidebars, `/subscribe/...`, and
   the browser tab. The original uploaded full logo remains
   `public/cleanma-logo.jpg`; the browser favicon and app icons use
   `public/cleanma-favicon.png`, a transparent copy derived from that mark.

### Scheduling convention

- Two cleans/month: first and third chosen weekday of each month.
- One to four cleans/month: first N chosen weekdays of the month.
- Five to eight cleans/month: chosen weekday plus an additional weekday three
  days later, taking the first N dates of the month. Times are UK local.
- Skipped appointments are **not** recreated on later renewal/webhook events.
- Failed automatic generation (for example, the SaaS job limit has been reached)
  produces an owner-visible alert without rejecting a successful Stripe payment.
