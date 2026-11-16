# Operational recording fixtures

The verified owner email in Supabase is **royyallstore@gmail.com** (two y characters), not royallstore@gmail.com. The script requires that owner and friend.cleaner@teste.com to already belong to the same company; otherwise the transaction aborts. It does not create Auth users or move memberships.

Run seed-recording-workspace.sql using an administrative database connection. The script inserts into live operational tables for that company, preserving existing unrelated rows. Generated UUIDs use the cleanma-recording-v1 namespace; invoice/customer/product numbers use MOCK-UK markers, notes identify synthetic records and all contact addresses use example.invalid. GPS coordinates are simulated. Messages are database fixtures, not email or WhatsApp sends. No Stripe transaction is created.

The script supplies 12 recent completed jobs, four recent cancellations, future jobs for the linked cleaner, £5,850 paid invoices, pending/overdue invoices, attendance, cleaning checklists, staff, property locations, materials, keys, reports, a maintenance incident and a conversation. Earlier monthly shifts support £3,400 in payroll through the application's existing payroll-hours trigger; these historical jobs are outside the last seven days. Other existing records may contribute additional totals in dashboards.

The Settings entry for the separate demo workspace has been removed. The old /admin/demo route and its private data are not used by these operational fixtures. Work orders do not currently have a dedicated register/table; a maintenance incident and cleaning jobs provide the existing operational records. Seeding alone does not add a new module or chart.

Inspect this namespace before any cleanup. Never delete all company records to remove these fixtures. Re-running uses stable IDs and does not duplicate seeded rows; dates are preserved for existing records.
