# Orygin Sandbox Control

[English](README.md) | 中文

这是一个私有 Cloudflare Worker，会把每个已认证的 Orygin workspace 映射到一个独立的 Cloudflare Sandbox。Railway 会签署每个控制请求；Worker 会拒绝重放，使用独立 secret 派生不透明 sandbox 标识，将文件操作限制在 `/workspace`，限制执行输出与超时时间，并负责 R2 备份和恢复。

必需 secrets：

- `SANDBOX_CONTROL_SECRET`：仅供 Railway 与此 Worker 使用的共享 HMAC secret；
- `SANDBOX_ID_SECRET`：用于 tenant/workspace 标识的独立 HMAC secret；
- `R2_ACCESS_KEY_ID` 与 `R2_SECRET_ACCESS_KEY`：仅限备份 bucket 的 credentials。

此 Worker 没有公开 route。Railway 通过它的 `workers.dev` hostname 或受 Cloudflare Access 保护的内部 hostname 访问。
