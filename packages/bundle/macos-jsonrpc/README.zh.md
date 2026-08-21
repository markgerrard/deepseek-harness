# `@deepseek-ai/dsh-macos-jsonrpc`

[English](README.md) | 中文

dsh macOS JSON-RPC 组合包。[`cordis.patch.yml`](cordis.patch.yml) 直接叠加在 [`dsh-base`](../base/README.md) 之上：禁用 HMR（热模块替换）、挂载 Code Mode 的 worker 运行时（[`dsh-code-runtime-worker-thread`](../../code-runtime/code-runtime-worker-thread/README.md)）、插入 JSON-RPC stdio 服务端（[`dsh-sdk-jsonrpc-server`](../../sdk/server/README.md)），并配置以 `code` 为默认 preset 的 Agent Presets（[`dsh-agent-presets`](../../preset/agent-presets/README.md)）。

该组合包不挂载任何终端 UI、Web 服务器或 stdout 日志记录器。进程的标准输出专用于 JSON-RPC 消息传输，以便与原生 macOS GUI 客户端应用通信。

## 模型体验

无影响，因为该组合包不添加任何模型可见的 token；提示词与工具由 base 层及配置的 agent presets 提供。

#### KV Cache 影响

无；该组合包不向请求前缀添加任何内容。

## 已知限制与暂缓事项

- **仅限 stdio 传输**：该组合包仅通过标准输入/输出流暴露 JSON-RPC，用于父进程监督。
