# Orygin Sandbox Control

English | [中文](README.zh.md)

Private Cloudflare Worker that maps each authenticated Orygin workspace to one
Cloudflare Sandbox. Railway signs every control request; the Worker rejects
replays, derives opaque sandbox identifiers with a separate secret, constrains
file operations to /workspace, bounds execution output and timeout, and owns
R2 backup/restore.

Required secrets:

- SANDBOX_CONTROL_SECRET: shared HMAC secret used only by Railway and this Worker;
- SANDBOX_ID_SECRET: separate HMAC secret for tenant/workspace identifiers;
- R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY: bucket-scoped backup credentials.

This Worker has no public route. Railway reaches its workers.dev hostname or a
Cloudflare Access-protected internal hostname.
