# Agent Note: TUI 的 connect、网关路由与两次确认退出

Status: implemented

[English](2026-08-18-tui-connect-and-quit.md) | 中文

## 问题

TUI 只检查 `DEEPSEEK_API_KEY`，无法保存密钥，也无法把请求路由到 OpenCode Go 或 Cline Pass。第一次 ctrl+c 也会立刻退出，而不是先确认。

## 决策

`/connect` 选择 OpenCode Go、Cline Pass 或官方 DeepSeek，并通过 `ctx.credentials.set` 存储密钥（`OPENCODE_API_KEY`、`CLINE_API_KEY`、`DEEPSEEK_API_KEY`）。TUI 组合包为 `llm-pi-ai` 叠加两条 `openai-completions` 路由：`opencode-go` 指向 `https://opencode.ai/zen/go/v1`，`cline-pass` 指向 `https://api.cline.bot/api/v1`。`/model` 按提供方分组列出这些目录；`installModelSelection` 把下一轮请求发到所选路由。官方 DeepSeek 仍走 `llm-deepseek`。第一次 ctrl+c 打开退出对话框（Are you sure you want to quit?，Yep! / Nope，默认选中 Nope）；第二次 ctrl+c 或 Yep 退出，n / Nope / esc 取消。

## 考虑过的替代方案

**另做一份 TUI 专用密钥文件。** 否决：官方凭证机制已经写入 `$DSH_HOME/.credentials.yaml`。

**复制参照 CLI 或 OpenCode 源码。** 否决：约束是只借参照产品的视觉语言，底层必须是官方 DSH 服务。

**把 OpenCode Go 做成一条混合协议路由。** 否决：`llm-pi-ai` 每条路由只有一种线路协议。responses-API 和 anthropic-messages 的 Go 模型保持不列出。

## 后果

**得到的**：可在 TUI 中粘贴密钥、选择网关模型，并支持两次 ctrl+c 确认退出。

**付出的**：不列出 `grok-4.5` / `gpt-5.6-luna`（responses）以及 OpenCode Go 的 anthropic-messages 模型。`OPENCODE_GO_API_KEY` 只用于首次引导的“已配置”判断；可写且路由使用的引用是 `OPENCODE_API_KEY`。

## 测试

单元测试锁定路由 baseURL、凭证引用、模型目录行、`maskSecret`，以及 `resolveQuitKey`（第一次 ctrl+c 打开、第二次退出、n/esc 取消、enter/space 确认当前按钮）。

## 暂缓

OpenCode Go 的 responses-API 模型，以及第二条 `anthropic-messages` OpenCode Go 路由。
