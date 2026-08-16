# Agent Note: SDK JSON-RPC session/cancel

Status: implemented

English | [中文](2026-08-15-sdk-session-cancel.zh.md)

## Problem

The SDK JSON-RPC transport had no way to abort a live turn. A client that needed to stop work killed the runtime process. Combined with lazy-create — which does not rehydrate a persisted session id — process-kill cancel loses the conversation and burns the id. ACP already cancels through `agent.cancel({ kind: 'user' })` on the addressed session and no-ops unknown ids.

## Decision

`session/cancel` is a client→server request whose params are `{ sessionId }`. The server looks the id up in its own session map. A hit calls `agent.cancel({ kind: 'user' })`, which aborts the in-flight turn and clears queued inbox work, then returns `{}`. An in-flight lazy create or resume is not a miss: the cancel joins that load's wire-ordered operation queue and is replayed at settlement between the messages it followed and the messages that followed it, because `agent.cancel` does not arm later work ([queue mechanism](../bug-fix/2026-08-16-sdk-cancel-load-settlement.md)). A true miss — no live record and no in-flight load — returns `{}` without creating a session.

A live-session prompt already returned its enqueue receipt; a prompt queued against an in-flight load settles with the load, alongside the cancel's own RPC. Cancel does not wait for idle and does not dispose the agent.

`HarnessClient.cancel` and the Python client's `session_cancel` send this method.

## Alternatives considered

**Make `session/prompt` block until idle and settle that RPC from cancel, as ACP does.** The SDK's enqueue-and-stream model is already shipped; changing prompt into a long-lived RPC would break every existing client.

**Treat transport close of one request as cancel.** JSON-RPC request abandonment already drops the client-side waiter without telling the server, so a timed-out prompt would still run. An explicit method is the only way to abort without tearing down the process.

**Treat an in-flight lazy create as unknown and no-op, matching ACP.** ACP inserts the session in `session/new` before `session/prompt` or `session/cancel`, so an unknown id is truly absent. The SDK creates lazily on first prompt; a no-op there reports success and then lets the turn run uncancelled.

**Cancel every descendant of the addressed session.** ACP cancels only the addressed session. Child subagents keep their own cancel path.

## Consequences

**Bought**: a client can abort one session without killing the runtime or burning the session id.

**Paid**: there is still no session-close method. A truly unknown id remains a no-op.

## Testing

Keyless unit: `cancels a session whose lazy creation is still in flight` fails if cancel treats an in-flight create as unknown. `cancels only the addressed live session and no-ops unknown ids` still pins the true-miss no-op. `packages/sdk/client/tests/sdk-client.spec.ts` records the wire params through the fake runtime. `python/sdk/tests/test_client.py` covers `session_cancel`.
