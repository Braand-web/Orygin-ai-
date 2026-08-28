# @orygin-ai/dsh-billing

English | [中文](README.zh.md)

Server-only Service Definition for Orygin commercial accounting. It owns the
ctx.billing service: estimates, atomic credit reservations and extensions,
provider and infrastructure receipts, root-run settlement, and append-only
refunds. Money crosses the seam as integer micro-USD and credits as integers.

Provider adapters report usage receipts but never alter wallets. Concrete
providers must make every operation idempotent and transactional and must round
cost to credits once at root-run settlement.

## Known Limitations and Deferred Work

- This package defines the capability only; the Supabase provider is deployed
  with the SaaS backend.
- Team billing and annual plans are outside the V1 contract.
