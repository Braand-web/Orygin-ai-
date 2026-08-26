# Orygin Cloudflare 网关

[English](README.md) | 中文

本目录包含把 `orygin.fun` 与 `www.orygin.fun` 代理到 Railway Web 运行时的 Cloudflare Worker。

Worker 会先验证公共 Host、`Sec-Fetch-Site` 与 `Origin`，再把浏览器身份转换为 Railway origin。它会保留授权信息、请求 body、查询参数和 WebSocket upgrade header。跨站 `/api` 请求仍会被拒绝，而同源浏览器请求能够到达后端身份验证层。

在本目录运行 `node --test orygin-gateway.test.mjs` 可执行聚焦的请求转换测试。在仓库根目录使用 `pnpm dlx wrangler@latest deploy --dry-run --config apps/web/cloudflare/wrangler.jsonc` 验证部署，移除 `--dry-run` 后即可正式部署。
