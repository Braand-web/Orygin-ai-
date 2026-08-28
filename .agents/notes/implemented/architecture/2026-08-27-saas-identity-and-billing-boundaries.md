# Agent Note: SaaS identity and billing boundaries

Status: implemented

English | [中文](2026-08-27-saas-identity-and-billing-boundaries.zh.md)

## Problem

The local harness treats one process, filesystem, settings store, and model credential set as one trusted user. Reusing those assumptions in a public service would let browser-supplied identity, global registries, or provider callbacks cross tenant and wallet boundaries.

## Decision

The Web transport authenticates a complete `AuthPrincipal`. Supabase resolves the active personal tenant and membership without accepting identity parameters, Cloudflare exchanges bearer tokens for origin-bound single-use WebSocket tickets, and Railway accepts the resulting identity only when its short-lived HMAC signature verifies. URL query tokens are rejected.

Commercial accounting is a separate `ctx.billing` service. LLM adapters emit immutable internal provider receipts and never update balances. Supabase owns private tenant/product tables, append-only credit grants and ledger entries, reservations with idempotent extensions, root-run settlement, payment-event ingestion, and rebuildable balance caches. Money is integer micro-USD and credit rounding happens once at root-run settlement.

The public Paddle endpoint verifies the untouched request body with Paddle's official SDK and durably inserts one hash-bound event before acknowledging it. Payment processing remains disabled until the deployment supplies its server-only keys and the pending event processor is enabled.

Cloud SaaS execution fails closed until `ORYGIN_CLOUD_EXECUTION_READY=1`. Privileged local settings, credentials, host-path, and model-discovery methods return a non-enumerating response in the SaaS profile. A dedicated Cloudflare Sandbox controller derives an opaque sandbox identity from tenant and workspace, rejects replayed control requests, confines paths under `/workspace`, and owns R2 checkpoints.

## Alternatives considered

**One credit balance column.** Direct balance mutation cannot reconstruct history, allocate expiring grants, make retries idempotent, or reverse a debit without destroying evidence.

**Supabase JWT in the WebSocket URL.** Query credentials leak through browser history and intermediary logs. A one-use ticket limits both exposure time and replay.

**Browser-to-OpenRouter calls.** A shared provider key would be extractable and would bypass authorization, reservations, spend limits, and receipt attribution.

**Executing user code on Railway.** Process-local execution shares the application host and cannot supply one filesystem and process world per workspace. Cloud execution stays unavailable until the remote sandbox provider replaces those local capabilities.

## Consequences

The schema and transports provide fail-closed foundations but do not by themselves make the current global session and workspace registries multi-tenant. Paid signups, billing enforcement, and cloud execution remain feature-flagged off until tenant-scoped persistence, the concrete billing provider, webhook processing, and cross-tenant tests are assembled. Local CLI behavior remains explicitly non-billable under the `local` principal.
