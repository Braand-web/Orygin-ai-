# Agent Note：首次对话不再强制 Workspace

Status: implemented

[English](2026-08-30-workspace-optional-first-chat.md) | 中文

## Problem

Web composer 曾把选择 Workspace 当作每次对话的前置条件。当前没有 Session 时，以及空白 Session 不再属于某个 Workspace 时，常驻文本框都会变成只读的 Workspace 选择器触发器。因此，新账户必须先理解并创建文件系统状态，才能向模型提出一个简单问题。

Runtime 也加强了同样的耦合：Workspace registry 为空时，初始选择保持空闲；全局 New Session 操作会清除当前选择，而不是创建对话。

## Decision

现在，无 Session composer 是“开始对话”控件，而不是 Workspace 控件。它的第一次指针或键盘操作会请求 runtime 根据部署默认值实例化纯聊天 Session。把创建延迟到用户手势，可以保留托管规则：认证只在受保护操作时出现，绝不仅因应用加载而出现。

Runtime 会先复用未归档且不属于任何 Workspace 的空白 Session；如果没有可复用项，则对新的 `session.create({})` 请求进行 single-flight。全局 New Session 操作使用同一路径，而在没有 Workspace 时，被动初始选择保持空闲。

未分组的空白 Session 会让 hero composer 保持完全可交互。Workspace chip 仍然可见，用户可在后续需要 repository 或文件系统任务时自愿切换；它不再锁定聊天，也不再比真正的模型阻断更优先。

## Alternatives considered

**自动创建默认 Workspace。** 否决，因为这会保留“每次对话都拥有 repository 或文件系统项目”的产品层假设，并创建用户未请求的 registry 状态。

**允许在 Session 存在前输入，然后迁移草稿。** 否决，因为 input machine 被有意设计为 Session-scoped。把无 Session composer 用作单手势启动控件，可以保留现有的所有权与提交契约。

**让 New Session 继续打开空的 Workspace 选择器。** 否决，因为核心聊天操作仍然会把用户带到设置流程，而不是对话。

## Testing

Runtime 测试覆盖被动冷启动行为、复用未分组的空白 Session、重复 New Session 手势的 single-flight 创建，以及现有的显式/当前/最近 Workspace 优先级。Conversation 测试覆盖无 Session 启动控件，并证明未分组的空白 Session 可以接收并提交文本，保留可选 Workspace chip，并且仍能显示可操作的模型选择阻断。

## Consequences

用户无需先理解 Workspace 就能立即开始聊天。只有当任务需要 repository 或文件系统上下文时，Workspace 才是必需的。在未来 cloud workspace 层为它们提供更丰富的产品标签之前，纯聊天 Session 会显示在现有的未分组对话区域中。
