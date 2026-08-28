# Supabase 资源授权

[English](README.md) | 中文

`@orygin-ai/dsh-authorization-supabase` 实现仅服务端使用的 `ctx.resourceAuthorization` 边界。它调用仅限 service role 的 PostgreSQL 函数，校验活跃成员资格以及工作区、会话、运行和凭据的准确租户所有权。拒绝结果不会泄露资源元数据，浏览器角色也不能执行该函数。
