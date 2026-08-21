# Agent Note: SDK prompt 在创建会话前等待插件树完成加载

Status: implemented

[English](2026-08-17-sdk-prompt-awaits-tree-settle.md) | 中文

## Problem

SDK JSON-RPC 服务器的 stdio 端口在插件树仍在挂载时就已接入，因此 `session/prompt` 可能在所有插件激活之前到达并创建会话。在那一刻创建的会话会为其首个请求组装出不完整的模型侧工具面，而该轮次会在缺少这些工具的情况下继续——毫无声息。使用 `@deepseek-ai/dsh-mcp-client` 可确定性复现（3/3）：该插件恰恰把自身激活阻塞在初始工具同步上，以便消费者能看到它的工具；紧跟 `initialize` 之后发出的首个 prompt 产生了没有任何 `mcp__*` 工具的模型请求，而第二个轮次才携带它们。对于整个用途就是其 MCP 工具的 agent（callhub 管理 leaf），第一个用户问题就会凭先验作答——这正是组合机制要防止的「自信却错误」的失败。配置条目顺序无法解决：stdio 监听器在自身 apply 注册后立即处理缓冲帧，与后续条目的激活无关。

## Decision

存在带 `await` 方法的 Loader 时，`HarnessSdkJsonRpcServer.prompt` 在查询会话映射之前先等待 `ctx.get('loader').await()`。启动完成后该调用立即解析，稳态 prompt 没有任何开销。没有 Loader 的手工挂载上下文完全不等待——守卫是一个 `typeof` 检查——保持其调用方依赖的同步 prompt→create 顺序（`server.spec.ts` 固定该顺序；全部 137 个 SDK 测试原样通过）。

组装应用层面的回归测试位于 `examples/callhub-agent/tests/keyless-smoke.e2e.ts`：该 leaf 把 `mcp-client` 排在 `sdk-jsonrpc-server` 之前，冒烟测试紧跟 `initialize` 发出 `session/prompt`，并断言第一个模型请求的工具列表等于精确的组合允许清单。此变更前 3/3 红，之后 3/3 绿。

`initialize` 现在也会在响应前等待插件树完成加载（由运行时的 `jsonrpc` 插件把关），因此急切的握手同样能看到异步同级能力。对工具面而言 prompt 侧的等待仍是权威：它覆盖不经 `initialize` 就发 prompt 的客户端，而没有 Loader 的手工挂载上下文在两条路径上都保持同步。

## Alternatives considered

- **只在 `initialize` 上把关**：作为唯一机制被否决——客户端可以不经 initialize 就发 prompt，且工具面的后果落在会话创建上，而不是握手上。
- **调整配置条目顺序让服务器最后挂载**：行不通；stdio 监听器在自身 apply 注册后立即处理缓冲帧，与后续条目的激活无关。
- **通过服务依赖阻塞 `mcp-client` 消费者**：SDK 服务器只注入 `agents`，且必须服务完全没有 MCP 的组合；为每个同级能力声明可选依赖无法扩展到任意 leaf。

## Consequences

Loader 挂载的组合的首个 prompt 总能看到完整组装的工具面，代价是首个 prompt 上的一次树完成等待（稳态免费）。手工挂载的测试上下文保持其同步 prompt→create 顺序，守卫不带来任何测试改动。永不完成加载的插件现在也会让首个 prompt 停住，而不是悄悄在缺少其工具的情况下继续服务——错误配置在边界上表现为挂起，而不是自信的错误回答。
