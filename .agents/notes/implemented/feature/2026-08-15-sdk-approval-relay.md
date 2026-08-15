# Agent Note: SDK JSON-RPC approval relay

Status: implemented

English | [中文](2026-08-15-sdk-approval-relay.zh.md)

## Problem

The runtime can raise `approval/request` (sandbox escalation, hooks), but the SDK JSON-RPC transport never relayed those asks to the client. The protocol README called server-to-client requests a dead capability. `initialize` has no capability negotiation, so an unconditional server-to-client request would hang every existing client: the TypeScript client had no request handler, and the Python `respond()` surface is pull-based — nobody drains `next_request()` today.

## Decision

Approvals are opt-in. `InitializeParams.clientCapabilities.approvals` must be exactly `true` before the server sends `session/request_permission`. Any other value leaves today's fail-closed path: the `approval/request` listener calls `next()` and writes no request.

The method is one-shot allow/reject over JSON-RPC, shaped after ACP's `session/request_permission` but returning the approval seam's closed `outcome` (`allowed-once` / `rejected` / `cancelled` / `unavailable`) instead of option ids. Only agents the server created are claimed; a same-id impostor or unknown session delegates. Transport loss or a thrown handler becomes `unavailable` so the turn is not wedged. A result outside the closed set becomes `rejected` and never grants. The ask's `AbortSignal` abandons the outbound RPC.

`HarnessClient.onRequest` answers inbound requests. The Python client already had `next_request` / `respond`; `initialize(client_capabilities=...)` is the advertisement.

## Alternatives considered

**Send the request unconditionally and rely on the transport's `-32601`.** The TypeScript transport would auto-reject, but the Python client queues inbound requests until the app calls `next_request()`. A hang is worse than the missing feature.

**Reuse ACP option ids (`allow-once` / `reject-once`).** The SDK owns both wire ends and the approval seam already names the outcomes. Mapping through a second vocabulary would add a translation with no client that needs it.

**Require a `callId`, as ACP does.** Escalation always has one; hook asks may not. The SDK streams full session events, so the client already has the tool call when an id is present.

## Consequences

**Bought**: an advertising client can grant or reject a live approval without a UI plugin on the runtime side.

**Paid**: `DeepSeekHarness` does not advertise, so the high-level `run()` path stays byte-identical. Child subagents the server did not create fail closed unless something else answers. A live but silent advertising client still blocks the ask until the tool signal aborts or the transport closes.

## Testing

Keyless unit: `does not send a server-to-client request unless the client advertised approvals` fails if the capability check is removed (the fixture records every `transport.request`). Advertising tests cover the closed outcomes, garbage → `rejected`, transport loss → `unavailable`, and foreign-agent delegation. `HarnessClient` and the Python client record the handshake field and the permission answer.
