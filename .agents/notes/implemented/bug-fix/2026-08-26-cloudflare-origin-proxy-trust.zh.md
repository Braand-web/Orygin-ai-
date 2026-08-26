# Agent Note: 通过 Cloudflare 代理保留浏览器信任

Status: implemented

[English](2026-08-26-cloudflare-origin-proxy-trust.md) | 中文

## 问题

Orygin 公共域名在 Cloudflare Worker 终止连接，再代理到 Railway Web 运行时。浏览器请求携带公共 `Origin`，而 Worker 发出的请求携带 Railway `Host`。后端浏览器信任防线会在 Supabase 身份验证之前正确拒绝这一不匹配组合，因此提供方发现、插件 API、agent preset 和事件流都会返回 HTTP 403。

如果不加判断地替换浏览器安全 header，真正的跨站请求也会被转换为可信 Railway 请求。代理必须先确认公共域名请求可信，再转换这些 header。

## 决策

`apps/web/cloudflare/orygin-gateway.mjs` 负责公共反向代理。它只接受 `orygin.fun` 和 `www.orygin.fun`。对于 `/api` 请求，它拒绝明确的跨站 Fetch Metadata 标记，并要求存在的 `Origin` authority 与公共请求 authority 相同。通过检查后，它才将 `Origin` 替换为 Railway origin，并把原值保存在 `X-Forwarded-Origin` 中用于诊断。

代理通过克隆的 `Request` 对原始请求进行流式转发，保留授权信息、请求正文、查询参数和 WebSocket upgrade header。`wrangler.jsonc` 负责 Worker 名称、兼容日期、路由和可观测性设置。

## 备选方案

**禁用后端浏览器信任防线。** 不予采用：身份验证不能替代 DNS rebinding 和跨站请求防护，未认证路由也仍然需要可信 authority。

**让后端信任 `X-Forwarded-Host`。** 不予采用：Railway 仍可被直接访问，如果没有独立认证的代理边界，客户端可以伪造该 header。

**不验证就重写所有 `Origin`。** 不予采用：这会让其他网站发起的请求在后端看来像同源请求。

## 影响

同源公共 API 和 WebSocket 请求会到达 Supabase 身份验证，而不是在浏览器信任防线失败。跨站 API 请求仍会被 Cloudflare 拒绝。Railway 部署可继续通过自身 hostname 直接测试，公共代理配置也可以在仓库中审查和复现。

## 测试

聚焦 Node 测试固定同源请求转换、授权与正文保留、WebSocket 查询参数与 upgrade 保留、拒绝跨站和格式错误的 origin、拒绝未列出的 host，以及允许普通跨站导航进入应用外壳。生产探测会区分预期的未认证 HTTP 401 与信任防线 HTTP 403，并验证两个公共域名。
