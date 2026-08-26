# Orygin Cloudflare gateway

English | [中文](README.zh.md)

This directory owns the Cloudflare Worker that proxies `orygin.fun` and `www.orygin.fun` to the Railway Web runtime.

The Worker validates the public Host, `Sec-Fetch-Site`, and `Origin` values before translating browser identity to the Railway origin. It preserves authorization, request bodies, query parameters, and WebSocket upgrade headers. Cross-site `/api` requests remain forbidden, while same-origin browser requests reach the backend authentication layer.

Run `node --test orygin-gateway.test.mjs` from this directory for the focused request-translation tests. Validate a deployment with `pnpm dlx wrangler@latest deploy --dry-run --config apps/web/cloudflare/wrangler.jsonc` from the repository root, then deploy by removing `--dry-run`.
