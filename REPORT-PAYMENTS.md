# [REPORT] CleanMa billing, Connect and Xero

## Provider operations completed

Live Stripe account: acct_1T56IvFn9iiryRd5, displayed by the connected provider as royallstore-buy.myshopify. No customer was charged.

| Plan | Monthly GBP | Stripe Price | Annual GBP (14% offer) | Stripe Price |
|---|---:|---|---:|---|
| Starter | 89.99 | price_1UbwFxFn9iiryRd5VAqtdCnN | 928.70 | price_1UbwGYFn9iiryRd5fnYR3I2t |
| Growth | 179.99 | price_1UbwGHFn9iiryRd5nOnv4epK | 1857.50 | price_1UbwGeFn9iiryRd5uB6PCo8F |
| Scale | 299.99 | price_1UbwGNFn9iiryRd530SxIUHd | 3095.90 | price_1UbwGmFn9iiryRd5VlPYJsdq |

Stripe Customer Portal configuration bpc_1UbwWKFn9iiryRd5u9WC5deo was created for these products/prices, payment method updates, invoice history, price changes with prorations and cancellation at period end. Price IDs and portal configuration were saved as server environment variables on the existing Vercel app project. PAYMENT_TOKEN_ENCRYPTION_KEY was generated and stored encrypted in Vercel, never committed or returned to the client.

## App source changes

- server/payments.mjs: remote Supabase identity validation and owner/company lookup; GBP catalogue verification; authenticated subscription Checkout; existing subscriptions go to Stripe Customer Portal; account ID check before charging; direct connected-account card charges with round(pence/100) application fee; active Growth/Scale server gate; OAuth state and AES-256-GCM token envelope.
- api/payments.js: authenticated checkout, quick-link, connection status and OAuth-start dispatcher.
- api/payment-oauth.js: Stripe Connect/Xero callback, browser-bound single-use state, provider token exchange and encrypted company-scoped persistence. Xero tenant ID is selected automatically only when exactly one organisation is authorised; multi-tenant authorisation remains unselected and requires a tenant-selection flow before accounting sync.
- api/stripe-webhook.js: raw-body signature checking, replay window, retrieve current subscription/invoice, official price recognition, paid-invoice access gate and idempotent atomic database update. Handles checkout.session.completed, customer.subscription.updated/deleted and invoice.paid/payment_failed. Other applications' events and Connect collection events do not activate SaaS subscriptions.
- src/components/admin/PaymentConnections.tsx and ScopedFinanceSettings.tsx: Connect Stripe and Connect Xero with truthful loading/error/status. No automatic accounting sync is claimed or performed.
- src/components/admin/PaymentsPage.tsx: real Stripe card links, description, GBP amounts, Copy Link and user-initiated WhatsApp sharing. Team payout section remains a labelled simulation. GoCardless remains unconfigured and disabled.
- src/routes/planos.tsx, src/lib/payment-api.ts, src/components/auth/AuthPage.tsx, src/components/admin/SubscriptionProvider.tsx, src/lib/subscriptions.ts: signed-in monthly/yearly subscription selection, preserved landing choice through sign-in, upgrade handoff and Growth/Scale collection entitlements.
- src/routes/client-payment-result.tsx: truthful return page; a browser redirect alone never confirms payment.
- supabase/migrations/20261115054928_real_billing_connect_xero.sql: private RLS-protected connections, OAuth state, claims, event ledger and subscription binding; only service_role can call payment persistence RPC. No client can write a plan or token through this RPC.
- src/lib/admin-records.functions.ts and src/lib/settings-external.functions.ts: migrate deprecated inputValidator calls to validator without changing schemas.
- scripts/package-payment-functions.mjs, package.json, vite.config.ts: explicit Vercel Nitro output plus separately packaged raw Node APIs; webhook remains a raw byte stream. Existing cron source untouched. Redundant tsconfig-paths plugin replaced by Vite native resolution. .env.example documents server configuration.

## Landing companion changes

The companion landing branch routes legacy pricing buttons to authenticated /admin/login with plan/interval; corrects secondary pricing page amounts to GBP and annual units; forwards authorised /api/checkout requests to the app backend. The live homepage already points to /admin/login. No frontend amount is used to determine subscription prices.

## Validation

Both builds passed with zero warnings/errors. App TypeScript passed. Six focused Node tests passed (webhook signature/replay/tampering, encrypted token round trip/tampering, connected-account destination and 1% fee, server entitlement gate, price tampering and browser OAuth-state binding). These tests use controlled provider responses and do not charge a card. End-to-end OAuth, customer payment and webhook delivery are NOT validated yet.

## Release blockers and deployment order

The database migration was applied successfully. Read-only verification confirmed that the persistence RPC rejects anon/authenticated execution and permits service_role. This code is held in draft until the remaining configuration and end-to-end RPC/provider paths are tested. The production owner application has NOT been replaced by this branch. A Vercel preview reached Ready; /planos and its CSS returned HTTP 200, and both payment APIs rejected GET with HTTP 405. These smoke checks do not validate authenticated payment flows. Vercel also emitted an npm runner warning about its cache-dir environment configuration; application deprecation warnings were corrected in the follow-up commit.

Required remaining environment variables: STRIPE_WEBHOOK_SECRET, STRIPE_CONNECT_CLIENT_ID, XERO_CLIENT_ID, XERO_CLIENT_SECRET. Register https://cleanmaapp.com/api/payment-oauth as redirect URL with Stripe Connect and Xero. Do not rotate PAYMENT_TOKEN_ENCRYPTION_KEY without re-encrypting stored tokens. The server key's Stripe account must match STRIPE_PLATFORM_ACCOUNT_ID (default pinned to the verified connected account).

After completing configuration: deploy reviewed app preview; test unauthorised requests and authenticated owner/tenant isolation; register the platform webhook at https://cleanmaapp.com/api/stripe-webhook and store its returned secret directly in Vercel; deploy production; test signed event delivery and duplicate/out-of-order events without purchasing anything; complete provider OAuth with an authorised owner; then run a user-approved controlled payment before claiming live end-to-end success. Publish landing companion only after the app handoff works. Main domain /api must stay on the owner app, not the marketing proxy.

Xero implementation is OAuth authorisation/storage for future invoice/customer/VAT reporting, not a finished reconciliation or tax filing engine. Full automatic invoice sync, refresh-token scheduling and multi-tenant selection remain follow-up work. Neither email identity alone nor a successful redirect activates a subscription.
