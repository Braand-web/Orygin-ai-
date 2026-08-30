# Agent Note：稳定的托管认证与详情面板

Status: implemented

[English](2026-08-30-stable-web-auth-and-details-panel.md) | 中文

## Problem

托管 Web 外壳曾通过替换 `#root` 的内容来渲染认证门。受保护操作或过期 access token 因而会卸载整个 React 应用，包括 composer 与详情面板。关闭认证门会重新加载页面；与此同时，已认证启动读取和 WebSocket ticket 请求持续返回 401，推动连接控制器反复创建 generation。另有一个独立问题：当 viewport 跨过最小适配阈值时，列求解器会把详情面板推导为零宽度，所以浏览器工具栏或滚动条造成的普通尺寸变化也可能让显式打开的面板时隐时现。

生产环境还缺少 ticket 交换所需的两项服务端事实：Supabase principal resolver 尚未迁移，Cloudflare 也没有 Supabase 与边缘签名 secret。

## Decision

认证门现在是追加在应用根节点旁边的 fixed modal。它只拥有并移除自己的 DOM 节点，保留下方产品的挂载状态，并且仅在成功登录或显式登出后重新加载。关闭 modal 会回到未改变的访客外壳。

浏览器载体把安全启动读取上的 401 视为会话过期边界：它请求登录，并返回与登出访客相同的净化访客投影。WebSocket ticket 交换上的 401 会变成类型化认证错误；下行流随后打开惰性访客流，而不是让连接 generation 失败。受保护 mutation 仍以 401 失败，并且绝不会抵达 Host。

列求解器仍先收缩详情栏，但显式打开的详情面板会停在 `DETAILS_MIN`。剩余不足由会话栏吸收。现在只有用户操作或会话操作能够关闭详情栏；调整窗口大小不能改变其打开状态。

托管身份路径使用已版本化的 SaaS foundation migration。`resolve_auth_principal()` 从 `auth.uid()` 推导用户与个人 tenant，只向 `authenticated` 授予执行权限，并让 private schema 对浏览器角色保持不可访问。Cloudflare 与 Railway 共享轮换后的 384-bit 边缘签名 secret；Supabase publishable key 只存在于公开客户端配置与 Worker secret binding 中。API 响应标记为 `no-store`，并关闭 invocation log，避免持久记录单次 ticket 的 query string。

## Alternatives considered

**每次认证提示后都重新加载。** 否决，因为它把可恢复的操作边界变成应用拆卸，并会重新制造视觉缺陷。

**通过通用 backoff 循环重试过期凭据。** 否决，因为确定性的 401 不会随时间自动变为有效。用户必须重新认证，同时安全访客外壳继续可用。

**保留带 hysteresis 的详情栏自动关闭。** 否决，因为 hysteresis 只会移动意外行为的阈值。显式面板应当拥有显式生命周期。

**通过 Supabase Data API policy 直接暴露 tenant 表。** 本阶段否决。Railway 继续作为 BFF，private schema 默认拒绝访问；只有狭窄的 principal resolver 可由已认证浏览器 token 调用。

## Testing

连接测试覆盖 `host.describe` 上的过期 bearer、被拒绝的 WebSocket ticket、未改变的登出投影、受保护操作门控以及正常 ticket 流。布局测试覆盖首选、受挤压、极窄与重新变宽的 viewport，并断言已打开详情栏绝不解析为零。Gateway 测试覆盖 origin 强制、凭据清除、单次 ticket 消费、认证基础设施缺失和 API `no-store` 响应。生产 Web build 与客户端 TypeScript project 均成功编译。

Supabase migration 已以事务方式应用。数据库 smoke check 证明 principal RPC 与 private table 存在、`anon` 无法执行 resolver、`authenticated` 可以执行，且四个 plan version 均已发布。Ledger 集成测试在回滚事务内运行，覆盖 Paddle 幂等性、资源授权、grant、reservation、provider usage、settlement 与 ledger 不可变性。

## Consequences

认证不再拥有应用生命周期，右侧面板也不会因偶发 viewport 几何变化而改变可见性。极窄 viewport 现在可能在保持显式详情面板打开时把会话栏压到零；未来的移动端呈现可以覆盖或堆叠面板，但必须维持同一显式开关约定。

Supabase security advisor 会有意报告没有 policy 的 private RLS table，因为这些 schema 不向浏览器授予权限。它也会报告 authenticated 可执行的 security-definer resolver；这是读取 `auth.users` 所需的狭窄无参数边界，其 execute 权限仍被明确限制。泄露密码保护属于 Supabase Auth dashboard 设置，仍是运营上线门，而不是数据库 migration。
