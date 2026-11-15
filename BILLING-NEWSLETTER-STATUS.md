# Annual billing selection and newsletter integration — draft

This branch is intentionally not released to the main app.

## Implemented code

- Monthly/yearly BRL selection survives the owner login and email-confirmation flow via validated URL/local-storage values.
- Authenticated RPC saves the user's selected plan, billing interval, currency and server-calculated amount in `subscription_selections`. It does not activate or mark a subscription as paid.
- `/planos` displays the same BRL offer and saves a selection. It explicitly explains that online checkout is not configured.
- `newsletter-subscribe` Edge Function validates email, explicit marketing consent, origin and the app's public key; uses a honeypot and a private hashed-IP rate counter; returns success only after the database write succeeds.
- `newsletter_subscribers` is unreadable by public visitors. Marketing access is restricted to the verified principal already treated as the platform owner in the app; tenant owners do not get access to global leads.
- `/admin/newsletter` lists 50 contacts per page and exports that page as CSV. No campaigns or emails are sent.

## Not completed / release blockers

1. The Supabase `apply_migration` confirmation expired twice. A read-only query confirmed both new public tables are still absent. The SQL in `supabase/migrations/20261114234918_landing_newsletter_and_billing_selection.sql` has NOT been applied or verified against the hosted database.
2. The Edge Function has NOT been deployed. After the migration is applied, deploy `supabase/functions/newsletter-subscribe/index.ts` to project `eymkowczlmbrfxlxcwdm` with platform JWT verification disabled: the handler checks the public app key itself, and this is a public opt-in endpoint. The service credential remains a managed server environment variable.
3. Neither CleanMa Vercel project has Stripe billing credentials. Provider discovery via the Vercel CLI requires account authorization. Stripe checkout/webhook integration is NOT implemented by this branch; no real payment was tested or collected. Do not treat selection storage as an active paid subscription.
4. After the hosted schema and function are deployed, run real opt-in, duplicate, rate-limit, anonymous-read denial, admin-read and authenticated selection tests before releasing this branch and the companion landing form PR.

## Validation

App production build and TypeScript check passed locally. The newsletter handler's validation/consent/honeypot/origin/key/rate-limit responses were tested with a mocked database only. Hosted insert, RLS and checkout verification remain pending for the reasons above.
