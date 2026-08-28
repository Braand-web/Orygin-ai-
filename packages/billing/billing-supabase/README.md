# `@orygin-ai/dsh-billing-supabase`

English | [中文](README.zh.md)

Production Supabase provider for `ctx.billing`. The package sends only server-authenticated calls to the narrow `public.billing_*` RPC surface; browser roles cannot execute those functions or access the private ledger tables.

The provider validates UUID attribution and integer monetary values before transport. PostgreSQL remains authoritative for the active plan, entitlements, concurrency, wallet locks, FEFO grant allocation, idempotency, reconciliation state, settlement, and compensating refunds.

The plugin reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the server environment. The service-role key must never enter a Cordis setting, browser bundle, sandbox, event log, or workspace.
