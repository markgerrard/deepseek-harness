# Agent Note: SDK JSON-RPC session/resume

Status: implemented

[English](2026-08-15-sdk-session-resume.md) | 中文

## 问题

SDK JSON-RPC 传输对未知会话 id 会惰性创建一个全新 agent。因此，指向同一 `DSH_SESSION_ROOT` 和同一 id 的新运行时会碰到持久化 id 冲突错误，而不会重新水合日志。再加上放弃卡住的运行时只能杀进程，缺少恢复会丢掉对话并烧毁该 id。`ctx.agents.resume()` 已经存在，也是 subagent 续体管理器用于冷恢复的路径。

## 决策

`session/resume` 是一条 client→server 请求，参数为 `{ sessionId }`。服务器在自己的会话表中查找该 id。命中则返回 `{}`，不重新加载。未命中则调用 `ctx.agents.resume({ resumeSessionId, agentOptions })`，带上手握中的 provider/model/`maxTokens`，然后存下 handle。持久化缺失、日志缺失、日志损坏、由更新 harness 写入，以及压缩模式不匹配，都以 JSON-RPC 错误原样传出。该方法从不创建全新会话。

对未知 id 的 `session/prompt` 仍会惰性创建。该默认行为不是隐式恢复。

`HarnessClient.resume` 与 Python 客户端的 `session_resume` 发送此方法。没有 `clientCapabilities` 标志：旧客户端只是从不调用它。

## 考虑过的替代方案

**在日志已存在时，把未知的 `session/prompt` id 当作隐式恢复。** 静默改变行为会掩盖当前用来诊断 id 复用的冲突，并且每次意外复用都会恢复。

**在 `session/prompt` 上增加 `resume: true` 标志。** 这会把会话生命周期与入队混在一起。续体管理器已经把 `ctx.agents.resume()` 与提交轮次分开；协议遵循这一拆分。

**通过 `clientCapabilities` 声明恢复能力。** 恢复是 client→server 方法。不认识它的客户端根本不会发送，因此再做握手声明只会增加状态，而没有需要保护的兼容性。

## 后果

**收益**：客户端可以在运行时进程退出后（包括被杀死后）重新水合已持久化的会话，而不烧毁该 id。

**代价**：客户端必须在已持久化的 id 上先发送 `session/resume` 再发送 `session/prompt`。忘记这一点仍会产生今天的冲突。

## 测试

无需密钥的单元测试：去掉该方法时，`resumes a persisted session and then accepts a prompt` 会失败。若 prompt 开始调用 `resume`，`prompt of a persisted unknown id still lazily creates and collides` 会失败。缺少持久化、缺少日志和损坏日志都会被拒绝。`HarnessClient` 与 Python 客户端记录协议参数。
