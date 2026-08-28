# @orygin-ai/dsh-request-context

[English](README.md) | 中文

Orygin 云端操作的服务端身份边界。它在异步 HTTP、RPC、WebSocket 与
Agent 工作中传播已验证的用户、租户、认证会话与角色，并且不接受请求负载
提供的身份。

## 已知限制与后续工作

- 传输适配器必须为每个独立送达的 WebSocket 消息显式进入身份作用域。
- 本地模式使用明确且不计费的 `local` 主体。
