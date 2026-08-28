# Agent Note: SaaS 身份与计费边界

Status: implemented

[English](2026-08-27-saas-identity-and-billing-boundaries.md) | 中文

## Problem

本地 harness 将单个进程、文件系统、设置存储和模型凭据集合视为一个可信用户。若公开服务继续使用这些假设，浏览器提供的身份、全局注册表或供应商回调就可能跨越 tenant 与钱包边界。

## Decision

Web 传输层验证完整的 `AuthPrincipal`。Supabase 在不接受身份参数的情况下解析活动个人 tenant 与成员关系；Cloudflare 将 bearer token 兑换成绑定来源且单次使用的 WebSocket ticket；Railway 仅在短时 HMAC 签名验证通过时接受对应身份。URL query token 一律拒绝。

商业计费是独立的 `ctx.billing` 服务。LLM 适配器只发送不可变的内部供应商回执，绝不更新余额。Supabase 负责私有 tenant/产品表、只追加的积分 grant 与 ledger entry、可幂等扩展的预留、根运行结算、支付事件摄取，以及可重建的余额缓存。金额使用微美元整数，积分只在根运行结算时取整一次。

公开 Paddle endpoint 使用 Paddle 官方 SDK 验证未修改的 request body，并在响应成功前持久写入一个绑定 hash 的唯一事件。在部署提供服务端密钥且待处理事件 processor 启用前，支付处理保持关闭。

云端 SaaS 执行在 `ORYGIN_CLOUD_EXECUTION_READY=1` 前保持 fail-closed。SaaS profile 中，本地特权设置、凭据、host path 和模型发现方法返回不可枚举响应。独立的 Cloudflare Sandbox controller 从 tenant 与 workspace 派生不透明 sandbox 身份，拒绝重放的控制请求，将路径限制在 `/workspace` 内，并负责 R2 checkpoint。

## Alternatives considered

**单个积分余额字段。** 直接修改余额无法重建历史、分配即将过期的 grant、让 retry 幂等，也不能在不破坏证据的前提下冲正 debit。

**在 WebSocket URL 中放置 Supabase JWT。** Query credential 会泄露到浏览器历史和中间层日志。单次 ticket 同时限制暴露时间与重放。

**浏览器直接调用 OpenRouter。** 共享供应商密钥可被提取，并会绕过授权、预留、消费上限与回执归属。

**在 Railway 上执行用户代码。** 进程本地执行共享应用 host，无法为每个 workspace 提供独立的文件系统和进程世界。在远程 sandbox provider 替换这些本地能力前，云执行保持不可用。

## Consequences

Schema 与传输层提供 fail-closed 基础，但不会自动让现有全局 session 与 workspace 注册表成为多租户。Tenant-scoped 持久化、具体 billing provider、webhook processor 与跨 tenant 测试完成组装前，付费注册、计费 enforcement 与云执行都由 feature flag 保持关闭。CLI 本地行为继续使用 `local` principal，并明确不计费。
