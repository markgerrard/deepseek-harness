# Agent Note: SDK JSON-RPC session/cancel

Status: implemented

English | [中文](2026-08-15-sdk-session-cancel.zh.md)

## Problem

The SDK JSON-RPC transport had no way to abort a live turn. A client that needed to stop work killed the runtime process. Combined with lazy-create — which does not rehydrate a persisted session id — process-kill cancel loses the conversation and burns the id. ACP already cancels through `agent.cancel({ kind: 'user' })` on the addressed session and no-ops unknown ids.

## Decision

`session/cancel` is a client→server request whose params are `{ sessionId }`. The server looks the id up in its own session map. A miss returns `{}` without creating a session. A hit calls `agent.cancel({ kind: 'user' })`, which aborts the in-flight turn and clears queued inbox work, then returns `{}`.

`session/prompt` already returned its enqueue receipt, so there is no pending prompt RPC to settle. Cancel does not wait for idle and does not dispose the agent.

`HarnessClient.cancel` and the Python client's `session_cancel` send this method.

## Alternatives considered

**Make `session/prompt` block until idle and settle that RPC from cancel, as ACP does.** The SDK's enqueue-and-stream model is already shipped; changing prompt into a long-lived RPC would break every existing client.

**Treat transport close of one request as cancel.** JSON-RPC request abandonment already drops the client-side waiter without telling the server, so a timed-out prompt would still run. An explicit method is the only way to abort without tearing down the process.

**Cancel every descendant of the addressed session.** ACP cancels only the addressed session. Child subagents keep their own cancel path.

## Consequences

**Bought**: a client can abort one session without killing the runtime or burning the session id.

**Paid**: a cancel that races the first `session/prompt`'s session creation no-ops, matching ACP's unknown-id rule. There is still no session-close method.

## Testing

Keyless unit: `packages/sdk/server/tests/server.spec.ts` asserts unknown ids no-op and only the addressed agent is cancelled. `packages/sdk/client/tests/sdk-client.spec.ts` records the wire params through the fake runtime. `python/sdk/tests/test_client.py` covers `session_cancel`.
