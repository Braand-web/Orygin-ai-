# Agent Note: Preserve browser trust through the Cloudflare proxy

Status: implemented

English | [中文](2026-08-26-cloudflare-origin-proxy-trust.zh.md)

## Problem

The public Orygin domains terminate at a Cloudflare Worker and proxy to the Railway Web runtime. A browser request carries the public `Origin`, while an outbound Worker fetch carries the Railway `Host`. The backend browser-trust fence correctly rejects that mismatched pair before Supabase authentication, so provider discovery, plugin APIs, agent presets, and event streams return HTTP 403.

Blindly replacing browser security headers would also convert a genuinely cross-site request into a trusted Railway request. The proxy must establish public-domain trust before translating those headers.

## Decision

`apps/web/cloudflare/orygin-gateway.mjs` owns the public reverse proxy. It admits only `orygin.fun` and `www.orygin.fun`. For `/api` requests, it rejects an explicit cross-site Fetch Metadata marker and requires any `Origin` authority to equal the public request authority. Only after those checks does it replace `Origin` with the Railway origin and preserve the original value in `X-Forwarded-Origin` for diagnostics.

The proxy streams the original request through a cloned `Request`, preserving authorization, request bodies, query parameters, and WebSocket upgrade headers. `wrangler.jsonc` owns the Worker name, compatibility date, routes, and observability settings.

## Alternatives considered

**Disable the backend browser-trust fence.** Rejected because authentication does not replace DNS-rebinding and cross-site request protection, and unauthenticated routes still require a trusted authority.

**Teach the backend to trust `X-Forwarded-Host`.** Rejected because Railway is also reachable directly and a client can forge that header unless an independently authenticated proxy boundary is added.

**Rewrite every `Origin` without validating it.** Rejected because it would turn requests initiated by another website into apparently same-origin backend requests.

## Consequences

Same-origin public API and WebSocket requests reach Supabase authentication instead of failing at the browser-trust fence. Cross-site API requests remain forbidden at Cloudflare. The Railway deployment stays directly testable under its own hostname, and the public proxy configuration is reviewable and reproducible from the repository.

## Testing

Focused Node tests pin same-origin request translation, authorization and body preservation, WebSocket query and upgrade preservation, rejection of cross-site and malformed origins, rejection of unlisted hosts, and acceptance of ordinary cross-site navigation to the application shell. Production probes distinguish the expected unauthenticated HTTP 401 from trust-fence HTTP 403 and verify both public domains.
