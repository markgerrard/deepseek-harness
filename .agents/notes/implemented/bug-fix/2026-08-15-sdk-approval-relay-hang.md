# Agent Note: Bound a silent advertising approval client

Status: implemented

English | [中文](2026-08-15-sdk-approval-relay-hang.zh.md)

## Problem

The [SDK approval relay](../feature/2026-08-15-sdk-approval-relay.md) waits on `ApprovalRequest.signal` for the client's `session/request_permission` answer. That field is optional. In-repo askers pass `exec.signal`, but the type, the SDK fixture, and any upstream asker may omit it. With `requestImpl = () => new Promise(() => {})` and no signal, the relay never settles: fail-closed becomes an unbounded hang.

The TypeScript transport answers `-32601` when no `onRequest` handler is installed, and the server maps that to `unavailable`. The Python client queues every inbound request. Advertising `{"approvals": True}` and forgetting a `next_request()` waiter leaves the turn stalled with no error. `request_timeout_seconds` defaults to `None` and does not bound the server-side wait.

## Decision

An advertising relay that has neither `request.signal` nor `approvalRequestTimeoutMs` calls `next()` and never writes a server-to-client request. `approvalRequestTimeoutMs` is an optional positive Config field on `dsh-sdk-jsonrpc-server`. When set, the outbound RPC is aborted by `AbortSignal.any` of the ask signal (if any) and that bound; abort or expiry settles `'unavailable'`. A live answer still applies the closed outcome set.

The Python client answers `-32601` (`method not found: session/request_permission`) when that method arrives and no `next_request()` waiter is registered. A waiter registered first still receives the request and answers with `respond`. Other inbound methods stay queued.

## Alternatives considered

**Always relay and rely only on a default timeout.** Rejected: a default would cut off a human answerer who is still reading the ask. Missing-signal delegation is immediate and does not invent a wait the asker did not provide.

**Auto-answer `rejected` instead of `-32601`.** Rejected: `rejected` is a grant decision. `-32601` is the TypeScript transport's existing "no handler" answer and already maps to `unavailable`.

**Queue `session/request_permission` by default and document the drain thread.** Rejected: the README already told users to drain, and forgetting that thread is the hang. Fail-safe must not depend on the drain starting first.

**Add a Python `on_request` push handler.** Rejected for this close: matching the TypeScript fail-safe (`-32601` when nobody is listening) is enough; the pull waiter remains the answer path.

## Consequences

An asker that omits `signal` cannot hang an SDK turn. A deployment that wants a bound even when the asker passed a signal sets `approvalRequestTimeoutMs`. Python and TypeScript now fail the same way when nobody is listening. Callers that pull must start `next_request()` before the ask arrives.

## Testing

`does not wait unbounded when an advertising client never answers an ask that has no signal` hangs without the `next()` guard. `times out a silent advertising client when approvalRequestTimeoutMs elapses` hangs without the bound. `test_unhandled_permission_request_answers_method_not_found` queues instead of writing `-32601` without the Python responder. `test_permission_request_is_queued_when_next_request_is_waiting` keeps the pull path.
