# `@orygin-ai/dsh-billing-supabase`

[English](README.md) | 中文

这是 `ctx.billing` 的生产级 Supabase 提供程序。该包只向受限的 `public.billing_*` RPC 表面发送服务器认证请求；浏览器角色不能执行这些函数，也不能访问私有账本表。

提供程序会在传输前验证 UUID 归属和整数金额。PostgreSQL 仍然是有效套餐、权限、并发限制、钱包锁、按到期时间分配额度、幂等性、对账状态、结算和补偿退款的权威来源。

插件从服务器环境读取 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`。服务角色密钥绝不能进入 Cordis 设置、浏览器包、沙箱、事件日志或工作区。
