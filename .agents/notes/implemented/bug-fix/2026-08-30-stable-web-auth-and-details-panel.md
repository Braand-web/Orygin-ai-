# Agent Note: Stable hosted authentication and details panel

Status: implemented

English | [中文](2026-08-30-stable-web-auth-and-details-panel.zh.md)

## Problem

The hosted web shell rendered its authentication gate by replacing the contents of `#root`. A protected action or expired access token therefore unmounted the complete React application, including the composer and details panel. Closing the gate reloaded the page, while authenticated boot reads and WebSocket ticket requests kept returning 401 and drove the connection controller through repeated generations. Separately, the column solver derived a zero-width details panel whenever the viewport crossed its minimum-fit threshold, so normal browser chrome and scrollbar changes could make an explicitly opened panel disappear and reappear.

Production also lacked the two server-side facts required by the ticket exchange: the Supabase principal resolver had not been migrated and Cloudflare had no Supabase or edge-signature secrets.

## Decision

The authentication gate is now a fixed modal appended beside the application root. It owns and removes only its own DOM node, keeps the product mounted underneath, and reloads only after a successful sign-in or an explicit sign-out. Closing the modal returns to the unchanged guest shell.

The browser carrier treats a 401 on a safe boot read as an expired-session boundary: it requests sign-in and returns the same sanitized guest projection used for a signed-out visitor. A 401 while exchanging a WebSocket ticket is represented by a typed authentication error; the downlink then opens the inert guest stream instead of failing the connection generation. Protected mutations still fail with 401 and never reach the Host.

The column solver still shrinks details first, but an explicitly open details panel stops at `DETAILS_MIN`. The conversation absorbs any remaining deficit. Only user or session actions can now close details; resizing cannot change its open state.

The hosted identity path uses the versioned SaaS foundation migration. `resolve_auth_principal()` derives the user and personal tenant from `auth.uid()`, grants execution only to `authenticated`, and leaves private schemas inaccessible to browser roles. Cloudflare and Railway share a rotated 384-bit edge-signature secret, while the Supabase publishable key exists only in the public client configuration and the Worker secret binding. API responses are marked `no-store`, and invocation logs are disabled so one-use ticket query strings are not persisted.

## Alternatives considered

**Reload after every authentication prompt.** Rejected because it converts a recoverable action boundary into an application teardown and recreates the visual defect.

**Retry expired credentials through the generic backoff loop.** Rejected because a deterministic 401 does not become valid with time. The user must re-authenticate while the safe guest shell remains usable.

**Keep automatic details auto-close with hysteresis.** Rejected because hysteresis only moves the surprise threshold. An explicit panel should have explicit lifetime ownership.

**Expose tenant tables directly through Supabase Data API policies.** Rejected for this phase. Railway remains the BFF and the private schemas are deny-by-default; only the narrow principal resolver is callable by an authenticated browser token.

## Testing

Connection tests cover a stale bearer on `host.describe`, a rejected WebSocket ticket, the unchanged signed-out projection, protected-action gating, and normal ticketed streams. Layout tests cover preferred, squeezed, tiny, and re-expanded viewports while asserting that open details never resolves to zero. Gateway tests cover origin enforcement, credential stripping, one-use ticket consumption, missing authentication infrastructure, and `no-store` API responses. The production web build and client TypeScript project compile successfully.

The Supabase migration was applied transactionally. Database smoke checks prove that the principal RPC and private tables exist, `anon` cannot execute the resolver, `authenticated` can, and all four plan versions are published. The ledger integration test ran inside a rolled-back transaction and covered Paddle idempotence, resource authorization, grants, reservations, provider usage, settlement, and ledger immutability.

## Consequences

Authentication no longer owns the application lifecycle, and the right panel no longer changes visibility because of incidental viewport geometry. A very narrow viewport can now squeeze the conversation to zero while keeping an explicitly open details panel; a future mobile presentation may overlay or stack panels, but it must preserve the same explicit open/close contract.

Supabase security advisors intentionally report private RLS tables without policies because those schemas have no browser grants. They also report the authenticated security-definer resolver, which is the narrow, argument-free boundary required to read `auth.users`; its execute privilege remains explicitly limited. Leaked-password protection is a Supabase Auth dashboard setting and remains an operational launch gate rather than a database migration.
