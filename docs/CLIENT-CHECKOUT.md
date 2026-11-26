# Client payments through Stripe Connect

Owner → Finance → Payments:
- **Collect from Client** still creates a one-off Stripe Checkout link and QR. New links require the payer's billing address. Stripe receives the 1% platform fee rounded to the nearest penny.
- **Client subscriptions** (below the existing sections) prepares a monthly/yearly Checkout. The owner selects an active client, sets the GBP amount and description, and shares the link. The payer enters email, billing address and payment details in Stripe (not a service address). The platform receives 1% of each eligible paid subscription invoice, not a surcharge added to the buyer's total.
- These are charges on the cleaning company's connected Stripe account. The company views payments, renewals, refunds and cancellations in its own Stripe Dashboard. The return URL doesn't confirm payment or settle a CleanMa invoice. The CleanMa platform account uses Stripe Balance and Connect application fee records for its revenue reconciliation.

## Before enabling recurring payments

The server intentionally defaults to off. Use isolated Stripe sandbox keys, an active sandbox connected account and test data. Do not use production data or card details in a preview.
1. In isolated testing, set the server-only flag `CLEANMA_CLIENT_SUBSCRIPTIONS_ENABLED=true` and set `STRIPE_PLATFORM_ACCOUNT_ID` to the sandbox platform. The production route restricts browser requests to `https://cleanmaapp.com`; use an isolated test harness for sandbox requests. Keep the existing Connect OAuth and SaaS billing workflow.
2. Generate a link for a test client, confirm billing address collection and complete a £100 sandbox payment. Verify a £1 application fee, then test renewal, failed card/retry, cancellation and refund/dispute handling. Review the merchant's Stripe Billing, customer cancellation and tax settings.
3. Before live exposure, verify delivery and handling of connected-account Checkout, invoice and subscription lifecycle events and refund/dispute events. Use a separate signed Connect event destination if consuming these in CleanMa; don't repoint the SaaS billing webhook. This feature doesn't add a local subscription ledger.
4. After acceptance, set `CLEANMA_CLIENT_SUBSCRIPTIONS_ENABLED=true` on the existing **app** Vercel project's Production environment and redeploy. Setting the flag to false stops new links after redeploy; it doesn't cancel already issued links or existing subscriptions. Manage those in Stripe.
