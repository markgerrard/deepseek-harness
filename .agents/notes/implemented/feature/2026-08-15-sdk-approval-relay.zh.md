# Agent Note: SDK JSON-RPC 审批转发

Status: implemented

[English](2026-08-15-sdk-approval-relay.md) | 中文

## 问题

运行时可以发出 `approval/request`（sandbox 升级、hooks），但 SDK JSON-RPC 传输从未把这些询问转发给客户端。协议 README 将 server→client 请求称为未使用的功能。`initialize` 没有能力协商，因此无条件的 server→client 请求会卡住每一个现有客户端：TypeScript 客户端没有请求处理器，而 Python 的 `respond()` 接口是拉取式的——今天没有人会去排空 `next_request()`。

## 决策

审批为选择加入。必须在 `InitializeParams.clientCapabilities.approvals` 恰好为 `true` 之后，服务器才发送 `session/request_permission`。任何其他值都走今天的失败关闭路径：`approval/request` 监听器调用 `next()`，且不写任何请求。

该方法是通过 JSON-RPC 的一次性允许／拒绝，形状参照 ACP 的 `session/request_permission`，但返回审批 seam 的封闭 `outcome`（`allowed-once` / `rejected` / `cancelled` / `unavailable`），而不是 option id。只认领服务器自己创建的 agent；同 id 冒充者或未知会话会委托。传输中断或处理器抛出变为 `unavailable`，以免卡住轮次。封闭集合之外的结果变为 `rejected`，且永不授予。询问的 `AbortSignal` 会放弃出站 RPC。

`HarnessClient.onRequest` 应答入站请求。Python 客户端已有 `next_request` / `respond`；`initialize(client_capabilities=...)` 是声明。

## 考虑过的替代方案

**无条件发送请求，并依赖传输层的 `-32601`。** TypeScript 传输层会自动拒绝，但 Python 客户端会把入站请求排入队列，直到应用调用 `next_request()`。卡住比缺少该功能更糟。

**复用 ACP 的 option id（`allow-once` / `reject-once`）。** SDK 同时拥有协议两端，且审批 seam 已经为 outcome 命名。再经过第二套词汇映射只会增加一次翻译，而没有需要它的客户端。

**像 ACP 那样要求 `callId`。** 升级路径总有 call id；hook 询问可能没有。SDK 以完整会话事件做流式传输，因此当 id 存在时客户端已经拥有该工具调用。

## 后果

**收益**：已声明能力的客户端可以授予或拒绝一次仍在进行的审批，而无需在运行时侧挂载 UI 插件。

**代价**：`DeepSeekHarness` 不会声明该能力，因此高层 `run()` 路径保持字节级一致。服务器未创建的子 subagent 会失败关闭，除非另有应答者。不作答的已声明客户端由[审批转发挂起](../bug-fix/2026-08-15-sdk-approval-relay-hang.md)收口：缺少询问信号且未配置超时时委托；已配置超时或询问信号到期变为 `unavailable`；Python 客户端在没有 `next_request()` 等待者时应答 `-32601`。

## 测试

无需密钥的单元测试：若去掉能力检查，`does not send a server-to-client request unless the client advertised approvals` 会失败（fixture 记录每一次 `transport.request`）。声明能力的测试覆盖封闭 outcome、非法应答 → `rejected`、传输中断 → `unavailable`，以及外站 agent 委托。挂起收口测试见[审批转发挂起](../bug-fix/2026-08-15-sdk-approval-relay-hang.md)。`HarnessClient` 与 Python 客户端记录握手字段和审批应答。
