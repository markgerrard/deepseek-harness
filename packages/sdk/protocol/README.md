# @deepseek-ai/dsh-sdk-protocol

English | [中文](README.zh.md)

The shared wire protocol for the DeepSeek Harness SDK runtime: one newline-delimited JSON-RPC 2.0 transport class plus the named request, result, and notification types both wire ends speak. The package root enumerates the protocol consumer interface; source modules are not exported as deep imports. The server side is the [`dsh-sdk-jsonrpc-server`](../server/README.md) plugin; clients are [`dsh-sdk-client`](../client/README.md) (TypeScript) and the [Python SDK](../../../python/README.md) (which mirrors these shapes but does not import them). A pure library — no plugin, no Config, no registration.

## Transport

`JsonRpcLineTransport` frames JSON-RPC 2.0 over caller-owned byte streams, one compact JSON frame per `\n`-terminated line. Frames with `id` and `method` are requests, `id` alone is a response, `method` alone is a notification; malformed JSON lines are ignored. `start()` attaches stream listeners, `close()` detaches them and rejects pending requests without destroying the streams. Missing request handlers answer `-32601`; handler rejections answer `-32603` with the error message. An error response rejects the pending `request()` with `JsonRpcResponseError`, which preserves the wire `code` and optional `data`. `JsonRpcTransportPeer` is the outbound surface (request/notify) the server class is typed against.

## Wire types

`types.ts` names every payload of the protocol served by `HarnessSdkJsonRpcServer`:

| Direction | Method | Types |
|---|---|---|
| client→server | `initialize` | `InitializeParams` → `InitializeResult` |
| client→server | `session/prompt` | `SessionPromptParams` → `SessionPromptResult` (durable enqueue receipt) |
| client→server | `session/cancel` | `SessionCancelParams` → `{}` (unknown ids are a no-op; in-flight create/resume is cancelled) |
| client→server | `session/resume` | `SessionResumeParams` → `{}` (rehydrates a persisted id; never creates) |
| client→server | `shutdown` | no params → `{}` |
| server→client | `session/request_permission` | `SessionRequestPermissionParams` → `SessionRequestPermissionResult` (only after `clientCapabilities.approvals`) |
| server→client | `session.event` | `SessionEventNotification` (every session in the runtime, unfiltered) |
| server→client | `session.status` | `SessionStatusNotification` (whole-agent `running`/`idle` transition) |
| server→client | `subagent.started` | `SubagentStartedNotification` |
| server→client | `subagent.finished` | `SubagentFinishedNotification` (in-process runs only) |

`session/resume` calls `ctx.agents.resume()` for the given id. An already-live id succeeds without reloading. An in-flight lazy create for the same id rejects resume rather than reporting rehydration of that fresh session. A concurrent `session/prompt` waits out an in-flight resume and still lazily creates if that resume fails. A missing persistence backend, missing log, corrupt log, or log written by a newer harness rejects with that backend's message; a compression-mode mismatch is the persistence backend's refusal. `session/prompt` on an unknown id still lazily creates and does not rehydrate. `InitializeParams.clientCapabilities.approvals` is the opt-in for `session/request_permission`: the server sends that request only when the field is exactly `true`. A client that omits it sees no server-to-client request. The client returns `{ outcome }` from the closed set `allowed-once` / `rejected` / `cancelled` / `unavailable`; any other result is treated as `rejected` and never grants. An ask with no `AbortSignal` and no timeout is delegated rather than waited on. Transport loss, a thrown handler, or a configured server approval timeout becomes `unavailable` so the turn is not wedged. `HarnessSdkRequestMap`, `HarnessSdkServerRequestMap`, and `HarnessSdkNotificationMap` index these by method name. `SessionPromptResult.messageId` identifies the queued `UserMessage`; it does not identify a later assistant message, turn ending, or prompt result. Clients combine the open-ended `session.event` stream with agent-wide `session.status` according to their own activity ownership. `SubagentFinishedNotification.lastAssistantMessage` contains the child's last non-empty assistant message or, when no such message exists, its accumulated assistant text; the field is absent when the child produced neither. `InitializeParams.maxTokens` is an optional positive safe integer that caps each conversation-model output for SDK-created agents and their in-process descendants; omission allows the selected adapter's exact-model default to apply, or otherwise preserves provider behavior. The notification payload types depend on `SessionEvent` (`dsh-session`), `ContentBlock` (`dsh-llm`), and `SubagentStopReason` (`dsh-subagent`) — the protocol streams full session-log envelopes, so the session vocabulary is part of the wire contract. `serverInfo.name` stays the wire-stable `deepseek-harness-sdk-runtime`.

## Model Experience

None, as this package defines the client-facing wire protocol; the model-visible surfaces belong to the runtime plugins composed behind the serving [`dsh-sdk-jsonrpc-server`](../server/README.md) entry.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No protocol-version negotiation** — the handshake carries only `serverInfo.version` (`0.0.1`, unvalidated by clients); pre-release stance, no compatibility promise.
- **No session-close method** — `session/cancel` aborts one live session's turn without disposing it; the runtime still owns the agent until process shutdown. See the [`dsh-sdk-jsonrpc-server` README](../server/README.md).
- **Approvals are opt-in** — a client that does not set `clientCapabilities.approvals: true` must never receive `session/request_permission`. An advertising client that disconnects mid-ask, times out, or never answers an ask that has no `AbortSignal` fails closed (`unavailable`); garbage answers are `rejected`.
