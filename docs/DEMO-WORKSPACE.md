# Demo recording workspace

Open **Settings → Generate Demo Data → Open Demo Workspace**, or `/admin/demo`.

The administrator remains authenticated as themselves. **Preview Sarah’s App** is an explicitly labelled, interactive cleaner preview; no fake Auth identity, password or staff account is created.

## Scenario

BrightSpark Cleaning Services has Sarah Jenkins, David Miller and Emma Watson; the requested three UK clients/properties; today's three jobs (£450 completed, £650 in progress, £220 scheduled); 12 completed jobs this week; £3,400 monthly payroll and £5,850 paid invoice revenue. The figures are calculated from stored records. Four additional future London shifts populate Sarah's schedule. Dates are generated in Europe/London and frozen on the scenario date for reproducible recordings.

Sarah and David's sample shifts are closed at 16:00/16:30. Clock In creates a new demo time entry; Clock Out closes it using London time. It has no GPS or payroll side effects.

## Isolation and cleanup

- `private.cleanma_demo_companies` and `private.cleanma_demo_records` are exclusive to this feature. They are never read by live billing, job, invoice, payroll or messaging integrations.
- The company and every cleaner/client/job/invoice/time-entry/payroll record have non-null `is_demo=true` enforced by a database constraint. No record points to an operational company or customer.
- Only an active owner can call `public.cleanma_demo_workspace`. The private implementation uses the verified `auth.uid()` and has no owner/company selector supplied by the browser.
- A transaction lock makes generation idempotent and serialises generation/clear/clock actions. Each owner has one demo workspace. The frontend cache is also scoped by authenticated user ID.
- **Clear Demo Data** deletes only the current owner's demo records and company with explicit `is_demo` predicates. Real tables and another owner's demo are untouched. Deleting the demo company cascades only to its constrained demo records.
- Demo records populate `/admin/demo`, not the live operational pages. The existing UI buttons, cards, semantic colours and table components are reused.

## Verification

`npm run build`, `npx tsc --noEmit`, `npm test`, `npm run test:payments`.

`supabase/tests/demo_workspace.sql` checks database generation, exact totals, idempotency, clocks, owner isolation, guarded deletion, absence of orphans and unchanged operational row counts. Run with an administrative database connection and an existing active owner. It rolls back all changes, including any pre-existing demo contents.

The migration creates empty demo storage only; nothing is seeded automatically on login, mount or deploy. Generate is the explicit recording action.
