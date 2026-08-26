# Agent Note: 会话加载期间保持 composer 稳定

Status: implemented

[English](2026-08-26-stable-composer-during-session-loading.md) | 中文

## 问题

会话开始回放历史时，最终应进入空白态还是活跃态尚未确定。会话外壳虽然保留了 composer 挂载，却在这段时间对整个 seat 应用 `visibility: hidden`。切换会话、重新连接或历史请求较慢时，聊天输入框会明显地出现、消失，然后重新绘制。

## 决策

在 settling 阶段让常驻 composer 保持可见并停靠在底部。它继续使用同一个 textarea DOM 节点，以现有的本地化历史加载文案进入禁用状态，并在回放确定最终阶段之前隐藏统计 dock。随后活跃状态会原地恢复；空白会话仍可把同一节点移动到居中的 Hero。

## 考虑过的替代方案

- 保留 `visibility: hidden`：它正是主要输入框闪烁问题的直接原因，因此拒绝。
- 渲染另一棵加载态 composer：切换组件树会破坏 DOM 身份、焦点与草稿稳定性，因此拒绝。
- 在回放期间启用 composer：提示可能与会话 hydration 竞态并使用不完整状态，因此拒绝。

## 后果

聊天输入框在会话加载、切换和重新连接期间持续保持绘制。用户看到的是禁用的加载态，而非空白底部。组件始终保留一棵 composer 与 textarea 树，并且在回放完成前不能提交请求。

## 测试

- 会话 skeleton 测试断言，未解析和摘要缺失的加载会话会显示带本地化加载文案的禁用 textarea。
- 既有启动自动选择 E2E 继续断言已知空白会话的 textarea 身份保持稳定。
