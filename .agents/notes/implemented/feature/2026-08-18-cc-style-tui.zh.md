# Agent Note: Claude Code 风格 TUI

Status: implemented

[English](2026-08-18-cc-style-tui.md) | 中文

## 问题

现有随附 surface 只有浏览器应用和一次性 headless runner。没有交互式终端 UI 来复用官方 DSH 的 agent、session、command、model、approval 和 credential 服务。需求是采用现有 agent CLI 的界面风格（Claude Code；第一版参照 Crush），但不移植该产品的源码，也不重写 agent loop。

## 决策

新增内置组合包 `@deepseek-ai/dsh-tui`，沿用 headless / web-app 模式：`tui` profile 模板（`dsh-base` 加本组合包）、`tui-startup` 命令行提供方，以及通过 `ctx.agents` 创建或恢复 Agent 并挂载 Ink 界面的 `tui-runner`。Claude Code 风格的布局、快捷键、落地页、覆盖层和工具卡片只属于展示层。斜杠分发、模型切换、会话列表/恢复、审批和向用户提问都调用官方 DSH 服务。产品标识是 DSH / DeepSeek，不是参照产品的标识。

## 考虑过的替代方案

**把参照 CLI 的源码移植进仓库。** 那会再分叉一套 agent loop、工具运行器和凭证存储。约束是只借参照产品的视觉语言，底层必须是官方 DSH 服务。

**新增能力组而不是组合包。** headless 和 web-app 已经证明了随附 profile 的模式。能力组会把重心移回 agent loop，而这次改动不能碰它。

**自研 TTY 渲染器。** Ink 加 React 18 与 web client 的 React 主版本一致，并且能让 chrome 辅助函数保持纯函数，从而在没有快照框架的情况下做单元测试。

## 后果

**得到的**：`dsh tui`（以及 tui profile）会自动初始化，并在与 web、headless 相同的服务之上启动交互式 Claude Code 风格界面。

**付出的**：参照产品的附加能力（附件、bang 模式 shell、MCP/LSP 面板、glamour Markdown）仍暂缓。凭证录入是走 ctx.credentials 的 /connect；第一次 ctrl+c 打开退出确认。TUI 只是展示层，缺少 `ctx.appExit` 时会明确失败。

## 测试

单元测试覆盖 layout、status、commands、state、chrome、cards、transcript 投影、connect 辅助函数和两次 ctrl+c 退出。Loader 组合测试覆盖 startup 提供方。runner 测试替换 Ink 渲染器，并用脚本化的 Agent factory 驱动。
