# Billing and newsletter status

Updated 15 November 2026.

The Supabase migration has been applied in production. Both public tables have RLS, and direct anonymous newsletter table access is denied. The newsletter Edge Function is ACTIVE with English responses. Hosted tests verified invalid-email rejection and successful insert; the reserved-domain test row was removed.

The English landing and newsletter form are published from the landing repository. Contacts can be inspected in the Supabase Table Editor. This draft PR still contains the app-side contacts screen and plan-selection/auth integration, which are NOT deployed. No paid checkout or subscription activation is implemented. Stripe configuration and payment webhook work remain pending.

Previous validation: app build and TypeScript passed; eight existing access tests passed. The app production code and routing are unchanged.
