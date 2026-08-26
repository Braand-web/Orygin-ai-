# Agent Note: Orygin catalog 身份边界

Status: implemented

[English](2026-08-26-orygin-catalog-identity.md) | 中文

## 问题

产品配置并选择的是 `orygin` 路由，但通用 pi-ai 适配器直接索引了兼容源 catalog，未做转换。因此提供方目录缺少 Orygin，模型发现返回源模型标识，而直接使用 catalog 回退时仍保留源显示名称、端点和凭据环境变量。这会破坏 Models 设置流程，并可能让默认请求离开 Orygin API。

## 决策

在构建已安装 catalog 索引时，仅在一个边界转换兼容源提供方。公开提供方为 `orygin`，显示为 Orygin，从已存密钥或 `ORYGIN_API_KEY` 解析凭据，默认指向 `https://api.orygin.fun`，并以 Orygin 名称公开 `orygin-v4-*` 模型。提供方的兼容流实现和协议元数据保持不变，使转换后的模型继续使用受支持的 wire format。

## 考虑过的替代方案

- 只重命名设置与 Web UI：后端发现、登录与默认分派仍会暴露或连接源提供方，因此拒绝。
- 在仓库数据中复制源 catalog：它会与已安装 pi-ai 的容量和协议元数据逐渐偏离，因此拒绝。
- 用协议工厂重新构建提供方：已安装提供方拥有通用适配器应保留的实现细节，因此拒绝。

## 后果

Orygin 现在是发现、模型选择、登录、凭据解析和分派全流程中的第一类已安装 catalog 路由。公开提供方列表不再包含源路由。上游 catalog 升级仍会提供容量与兼容元数据，而转换测试会在边界明确断言产品自有身份。

## 测试

- catalog、发现、登录与适配器聚焦测试共 145 项通过。
- Web Models 设置 E2E 预期并选择 `orygin`。
- 生产探针另行验证已认证 API 的信任边界。
