# Agent Note: 为不作答的已声明审批客户端设界

Status: implemented

[English](2026-08-15-sdk-approval-relay-hang.md) | 中文

## 问题

[SDK 审批转发](../feature/2026-08-15-sdk-approval-relay.md)会为客户端的 `session/request_permission` 应答等待 `ApprovalRequest.signal`。该字段是可选的。仓库内的询问者会传入 `exec.signal`，但类型、SDK fixture 以及任何上游询问者都可能省略它。当 `requestImpl = () => new Promise(() => {})` 且没有信号时，转发永远不会结束：失败关闭变成无界挂起。

TypeScript 传输层在未安装 `onRequest` 处理器时应答 `-32601`，服务器将其映射为 `unavailable`。Python 客户端会把每一条入站请求排入队列。声明 `{"approvals": True}` 却忘记 `next_request()` 等待者时，轮次会在没有任何错误的情况下停住。`request_timeout_seconds` 默认为 `None`，也不会限制服务器侧的等待。

## 决策

既没有 `request.signal` 也没有 `approvalRequestTimeoutMs` 的已声明转发会调用 `next()`，并且不写任何 server-to-client 请求。`approvalRequestTimeoutMs` 是 `dsh-sdk-jsonrpc-server` 上可选的正整数 Config 字段。设置后，出站 RPC 由询问信号（若有）与该上限的 `AbortSignal.any` 中止；中止或到期会以 `'unavailable'` 结束。仍然及时到达的应答继续适用封闭 outcome 集合。

当该方法到达且没有已注册的 `next_request()` 等待者时，Python 客户端应答 `-32601`（`method not found: session/request_permission`）。先注册的等待者仍会收到该请求，并用 `respond` 作答。其他入站方法仍会入队。

## 考虑过的替代方案

**始终转发，只依赖默认超时。** 否决：默认值会截断仍在阅读询问的人类应答者。缺少信号时的委托是立即的，不会发明询问者并未提供的等待。

**自动应答 `rejected` 而不是 `-32601`。** 否决：`rejected` 是授予决定。`-32601` 是 TypeScript 传输层既有的“无处理器”应答，并且已经映射为 `unavailable`。

**默认把 `session/request_permission` 排入队列，并在文档中要求排空线程。** 否决：README 已经告诉用户去排空，而忘记该线程正是这次挂起。失败安全不得依赖排空先启动。

**增加 Python 的 `on_request` 推送处理器。** 此次收口否决：与 TypeScript 的失败安全对齐（无人监听时 `-32601`）已经足够；拉取等待者仍是作答路径。

## 后果

省略 `signal` 的询问者无法挂起一次 SDK 轮次。即使询问者传入了信号、仍希望设界的部署可设置 `approvalRequestTimeoutMs`。无人监听时，Python 与 TypeScript 现在以同一方式失败。采用拉取的调用方必须在询问到达之前启动 `next_request()`。

## 测试

若去掉 `next()` 守卫，`does not wait unbounded when an advertising client never answers an ask that has no signal` 会挂起。若去掉该上限，`times out a silent advertising client when approvalRequestTimeoutMs elapses` 会挂起。若去掉 Python 应答器，`test_unhandled_permission_request_answers_method_not_found` 会入队而不是写入 `-32601`。`test_permission_request_is_queued_when_next_request_is_waiting` 保留拉取路径。
