# Agent Note: SDK JSON-RPC session/cancel

Status: implemented

[English](2026-08-15-sdk-session-cancel.md) | 中文

## 问题

SDK JSON-RPC 传输没有中止仍在进行的轮次的方法。需要停下手头工作的客户端只能杀死运行时进程。再加上惰性创建——它不会把已持久化的会话 id 重新水合——以杀进程的方式取消会丢掉对话并烧毁该 id。ACP 已经通过对指定会话调用 `agent.cancel({ kind: 'user' })` 来取消，并对未知 id 做空操作。

## 决策

`session/cancel` 是一条 client→server 请求，参数为 `{ sessionId }`。服务器在自己的会话表中查找该 id。未命中则返回 `{}`，且不创建会话。命中则调用 `agent.cancel({ kind: 'user' })`——这会中止正在进行的轮次并清空排队的 inbox 工作——然后返回 `{}`。

`session/prompt` 已经返回了入队回执，因此没有待结算的提示词 RPC。取消不等待 idle，也不会 dispose（资源释放）该 agent。

`HarnessClient.cancel` 与 Python 客户端的 `session_cancel` 发送此方法。

## 考虑过的替代方案

**让 `session/prompt` 阻塞到 idle，并像 ACP 那样从 cancel 结算该 RPC。** SDK 的入队并流式传输模型已经发布；把 prompt 改成长生命周期 RPC 会破坏每一个现有客户端。

**把单条请求的传输关闭当作取消。** JSON-RPC 请求放弃已经会丢掉客户端等待者而不通知服务器，因此超时的 prompt 仍会继续运行。显式方法是在不拆掉进程的前提下中止的唯一途径。

**取消指定会话的每一个后代。** ACP 只取消指定会话。子 subagent 保留各自的取消路径。

## 后果

**收益**：客户端可以中止一个会话，而不必杀死运行时或烧毁会话 id。

**代价**：与第一次 `session/prompt` 的会话创建竞态的取消会空操作，这与 ACP 的未知 id 规则一致。仍然没有会话关闭方法。

## 测试

无需密钥的单元测试：`packages/sdk/server/tests/server.spec.ts` 断言未知 id 为空操作，且只有指定 agent 被取消。`packages/sdk/client/tests/sdk-client.spec.ts` 通过假运行时记录协议参数。`python/sdk/tests/test_client.py` 覆盖 `session_cancel`。
