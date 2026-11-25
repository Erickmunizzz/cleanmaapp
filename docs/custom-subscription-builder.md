# CleanMa custom self-serve subscriptions (British English, GBP)

This feature is **additive**. It does not replace authentication, the SaaS 14-day trial,
the SaaS paywall, or existing subscription data. It also creates **no fixed client
pricing plans or Stripe Price IDs**. The client chooses the number of weekly visits,
weekdays, start time, duration and price per visit. The server recalculates the
amount in GBP pence; Stripe Checkout creates the monthly recurring Price inline.

## Deploy this branch in order

1. Deploy the previous `feature/trial-block` and `feature/subscription-plans`
   database migrations first, if they are not already applied.
2. Apply the new additive migration
   `supabase/migrations/20261125044433_custom_self_serve_subscription_builder.sql`
   using the normal reviewed Supabase migration workflow in **staging** first.
   The migration creates five tables, owner-isolated read policies and
   service-role-only scheduling/payment functions. It does not alter or remove
   previous tables, users, jobs, authentication or trial rules.
3. Ensure the Vercel project serving the app (not a legacy proxy target) has:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
   - `STRIPE_SECRET_KEY` for the platform, `STRIPE_PLATFORM_ACCOUNT_ID`,
     and the existing Stripe Connect Standard OAuth configuration.
   - **New:** `STRIPE_CUSTOM_WEBHOOK_SECRET` (a separate endpoint signing secret).
   - `RESEND_API_KEY`, and **new optional** `CLEANMA_CLIENT_PORTAL_FROM`;
     if omitted, existing `CLEANMA_INVITE_FROM` is used as the email sender.
   Configure environment secrets as sensitive Vercel environment variables;
   do not put them in repository files or client-side code.
4. In Stripe, configure a **connected-accounts** webhook destination at
   `https://cleanmaapp.com/api/custom-subscriptions-webhook`, receiving:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`,
   `customer.subscription.created/updated/deleted/paused/resumed`,
   `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`,
   `charge.refunded`, `charge.dispute.created`, `radar.early_fraud_warning.created`.
   Copy its **own** signing secret into `STRIPE_CUSTOM_WEBHOOK_SECRET`.
   Keep the existing SaaS and previous client subscription webhooks intact.
5. Deploy the app. The existing `clean-app-landig-` reverse proxy branch
   `feature/subscription-plans` already includes the `/subscribe/:path*` rule,
   which is needed for both `/subscribe/[company-slug]` and its `/manage` path.
   Do not point `cleanmaapp.com` at an old Vercel app without environment keys.

## End-to-end test (Stripe sandbox)

1. Sign in as the cleaning company owner. Open `/admin` and select
   **Create my subscription link**; this opens Payments. Under
   **Custom client subscriptions**, click **Create my subscription link**.
   Copy the company-specific `/subscribe/[company-slug]` link. Confirm no fixed
   prices or presets are shown. A second click or refresh must retain the same
   link. A company without a ready connected Standard Stripe account cannot
   start Checkout.
2. Open the link as a signed-out client. Choose **3× per week**, tick
   **Monday, Wednesday and Friday**, choose 09:00, four hours, and enter
   **£25.00 per visit**. Verify the live summary is **£300.00/month**
   (`3 × £25 × 4`). Enter full name, email, phone, address and postcode.
   Subscribe. In the Stripe sandbox use card **4242 4242 4242 4242**,
   a future expiry, any three-digit CVC and a valid postcode.
3. Verify in the **connected Stripe account** that the subscription's
   recurring invoice is **GBP 300.00**, that its `application_fee_percent`
   is **1**, and that the platform application fee is **GBP 3.00**.
   Before Stripe's processing fee, the business retains **GBP 297.00**;
   actual net payout is lower by Stripe's real processing charge.
4. After Stripe delivers its *signed* checkout / invoice events, refresh the
   owner Payments view. The subscriber should show **Pending approval**.
   Check the generated `public.jobs` on the owner's calendar — future
   Monday, Wednesday and Friday entries are explicitly labelled
   **Pending owner approval**. Click **Accept** to make them active.
   **Pause 1 visit** and **Skip 1 week** must cancel only those job occurrences;
   Stripe billing must remain active. **Cancel** stops future billing and
   visits. **Decline** also stops future billing and visits, but a charge
   already captured must be refunded explicitly in Stripe if applicable.
5. Open the company's `/subscribe/[company-slug]/manage` page, submit the
   checkout email, and open the secure email link within **30 minutes**.
   Change from 3 visits to 2, choose two preferred days, enter a new price,
   and save. Confirm both the next Stripe invoice price (inline dynamic Price,
   no fixed Price ID; no proration) and the future calendar schedule have
   changed. Previously completed and skipped visits remain in history.
6. Send a sandbox `invoice.payment_failed` event. Confirm subscription
   becomes `past_due` and future visits are cancelled; resolving the invoice
   should allow the signed webhook to restore the appropriate future schedule.
7. Re-test existing `/auth`, `/admin/login`, `/cleaner`, SaaS trial and SaaS
   paywall separately: their code paths are not changed by this feature.

## Operational notes

- The monthly price uses the requested **fixed four-week multiplier**.
  Calendar visits follow the selected weekdays and can therefore include a
  fifth occurrence in long calendar months; monthly billing remains fixed.
- All recurrence times are interpreted in **Europe/London**, including DST.
  Visits are generated in a rolling four-month window when Stripe lifecycle
  events arrive; deploy a periodic replenishment job before month five if no
  subscription events will arrive in that period.
- In the event of a job quota or scheduling failure, the subscription can
  still be paid; the owner dashboard displays a scheduling warning requiring
  manual remediation. Do not silently treat that as a failed payment.
- A client email link is a **30-minute bearer token**. Its SHA-256 digest,
  never its raw value, is stored in Supabase. The public API only shows
  a generic response when no matching email is found. The browser removes
  the raw token from the address bar after loading it.
- A rate change uses a dynamic Stripe Subscription Item `price_data` with
  `proration_behavior=none`; the new amount takes effect on the next invoice.
  Existing access tokens and signup/login are unaffected.
- Owner-initiated **Decline** cancels billing and future work but does **not**
  automatically refund prior invoices. Review any existing payment in Stripe
  and issue a refund before telling a rejected client they were reimbursed.
- The business is merchant of record (direct charges on its Standard Connect
  account). Stripe processing fees are separate from CleanMa's 1% fee.
  Assess UK VAT treatment and whether Stripe Tax/registrations are appropriate
  before collecting live payments.
- The `custom_subscription_portal_tokens` table should be periodically purged
  of expired hashed tokens as an operational maintenance task. Do not log
  magic-link tokens or send raw tokens to analytics.
- A final real connected-account sandbox checkout, webhook and scheduling
  test is required before production activation; mocked unit tests cannot
  verify an actual Stripe payout or Supabase migration.
