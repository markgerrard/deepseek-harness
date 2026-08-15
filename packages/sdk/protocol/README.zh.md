# @deepseek-ai/dsh-sdk-protocol

[English](README.md) | 中文

DeepSeek Harness SDK 运行时的共享协议格式（wire format）：一个按换行分帧的 JSON-RPC 2.0 传输类，加上协议两端共同使用的具名请求、结果与通知类型。包根枚举协议消费方接口；源模块不支持深层导入。服务端是 [`dsh-sdk-jsonrpc-server`](../server/README.md) 插件；客户端是 [`dsh-sdk-client`](../client/README.md)（TypeScript）与 [Python SDK](../../../python/README.md)（后者复现这些结构但不导入它们）。纯库——无插件、无 Config、无注册。

## 传输

`JsonRpcLineTransport` 在调用方持有的字节流上为 JSON-RPC 2.0 分帧，每行一个紧凑 JSON 帧、以 `\n` 结尾。带 `id` 与 `method` 的帧是请求，仅 `id` 是响应，仅 `method` 是通知；非法 JSON 行被忽略。`start()` 挂接流监听器，`close()` 移除监听器并拒绝挂起请求，但不销毁流。缺失请求处理器时应答 `-32601`；处理器返回的 Promise 被拒绝时，则应答携带错误消息的 `-32603`。错误响应会以 `JsonRpcResponseError` 拒绝挂起的 `request()` Promise，并保留协议格式中的 `code` 与可选 `data`。`JsonRpcTransportPeer` 是服务器类据以进行类型声明的出站接口（request/notify）。

## 协议类型

`types.ts` 为 `HarnessSdkJsonRpcServer` 所服务协议的每个载荷命名：

| 方向 | 方法 | 类型 |
|---|---|---|
| client→server | `initialize` | `InitializeParams` → `InitializeResult` |
| client→server | `session/prompt` | `SessionPromptParams` → `SessionPromptResult`（持久入队回执） |
| client→server | `session/cancel` | `SessionCancelParams` → `{}`（未知 id 为空操作） |
| client→server | `session/resume` | `SessionResumeParams` → `{}`（重新水合已持久化的 id；从不创建） |
| client→server | `shutdown` | 无参数 → `{}` |
| server→client | `session/request_permission` | `SessionRequestPermissionParams` → `SessionRequestPermissionResult`（仅在 `clientCapabilities.approvals` 之后） |
| server→client | `session.event` | `SessionEventNotification`（运行时内每个会话，不过滤） |
| server→client | `session.status` | `SessionStatusNotification`（整个 agent（智能体）的 `running`/`idle` 转换） |
| server→client | `subagent.started` | `SubagentStartedNotification` |
| server→client | `subagent.finished` | `SubagentFinishedNotification`（仅进程内运行） |

`session/resume` 对给定 id 调用 `ctx.agents.resume()`。已存活的 id 无需重新加载即成功。缺少持久化后端、缺少日志、损坏的日志，或由更新的 harness 写入的日志，会以该后端的消息拒绝；压缩模式不匹配是持久化后端的拒绝。对未知 id 的 `session/prompt` 仍会惰性创建，不会重新水合。`InitializeParams.clientCapabilities.approvals` 是 `session/request_permission` 的选择加入项：仅当该字段恰好为 `true` 时，服务器才发送该请求。省略该字段的客户端不会收到任何 server→client 请求。客户端从封闭集合 `allowed-once` / `rejected` / `cancelled` / `unavailable` 返回 `{ outcome }`；任何其他结果都按 `rejected` 处理，且永不授予。传输中断或处理器抛出时变为 `unavailable`，以免卡住轮次。`HarnessSdkRequestMap`、`HarnessSdkServerRequestMap` 与 `HarnessSdkNotificationMap` 按方法名索引这些类型。`SessionPromptResult.messageId` 标识已排队的 `UserMessage`；它不标识后续的助手消息、轮次结束或提示词结果。客户端根据自己对活动区间的所有权，组合持续开放的 `session.event` 流与 agent 级的 `session.status`。`SubagentFinishedNotification.lastAssistantMessage` 包含子 agent 最后一条非空 assistant 消息；若不存在这类消息，则包含其累积的 assistant 文本；子 agent 两种输出均未产生时，该字段缺省。`InitializeParams.maxTokens` 是可选的正的安全整数，用于限制 SDK 创建的 agent 及其进程内后代的每次对话模型输出；省略时会应用所选适配器的确切模型默认值，否则提供方行为保持不变。通知载荷类型依赖 `SessionEvent`（`dsh-session`）、`ContentBlock`（`dsh-llm`）与 `SubagentStopReason`（`dsh-subagent`）——协议以完整会话日志封套进行流式传输，因此会话词汇是协议格式约定的一部分。`serverInfo.name` 的协议值固定为 `deepseek-harness-sdk-runtime`。

## 模型体验

无，因为此包定义面向客户端的协议格式；模型可见接口属于组合在对外服务入口 [`dsh-sdk-jsonrpc-server`](../server/README.md) 后方的运行时插件。

#### KV Cache 影响

无；此包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **无协议版本协商**——握手只携带 `serverInfo.version`（`0.0.1`，客户端不校验）；处于预发布阶段，无兼容承诺。
- **无会话关闭方法**——`session/cancel` 会中止一个仍存活会话的轮次，但不会 dispose（资源释放）该会话；运行时仍持有该 agent，直到进程关闭。见 [`dsh-sdk-jsonrpc-server` README](../server/README.md)。
- **审批为选择加入**——未设置 `clientCapabilities.approvals: true` 的客户端绝不能收到 `session/request_permission`。已声明能力的客户端在询问中途断开时以失败关闭（`unavailable`）；非法应答视为 `rejected`。
