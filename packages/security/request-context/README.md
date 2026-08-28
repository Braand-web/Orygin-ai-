# @orygin-ai/dsh-request-context

English | [中文](README.zh.md)

Server-only identity boundary for Orygin cloud operations. It propagates the
verified user, tenant, authentication session and roles through asynchronous
HTTP, RPC, WebSocket and agent work without accepting identity from payloads.

## Known Limitations and Deferred Work

- Transport adapters must explicitly enter the scope for every independently
  delivered WebSocket message.
- Local mode uses the explicit non-billable `local` principal.
