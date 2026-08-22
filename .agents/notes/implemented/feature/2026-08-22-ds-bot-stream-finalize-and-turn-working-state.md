# Agent Note: DS Bot stream finalization and turn-lifecycle working state

Status: implemented

English | [中文](2026-08-22-ds-bot-stream-finalize-and-turn-working-state.zh.md)

## Problem

Two chat-surface defects. A turn aborted mid-stream delivered no `assistant/message`, so the projector left its buffer open forever: every render re-appended a phantom still-streaming bubble at `seq: Int.max` containing the whole aborted reply, and render backoff stayed pinned at its slowest tier (one stored transcript held 8,677 chunk events after the last message). Separately, the working indicator flipped on at send and off the moment the prompt was accepted, and never returned for a plain-text reply — the in-flight test matched only running tools, streaming reasoning, or workflows, never streaming assistant text.

## Decision

`TranscriptProjector.finalizeStream(seq:)` converts any buffered stream into finished items on `step/end` and `turn/end`, keeping the delivered prefix visible; hydration replays stored events through the same path, so existing chats self-repair on load without a migration. Working state is now turn-lifecycle-driven: `awaitingTurnSessions` covers send → `turn/start` (cleared on delivery failure), `activeTurnSessions` covers `turn/start` → `turn/end`; `isTurnActive` unions them so the indicator is continuous, including between chunks.

## Alternatives considered

**Closing the stream only on a later `assistant/message`.** Rejected: an aborted turn never delivers one, which is precisely the leak. **Driving the indicator off `session.status` events.** Deferred: equally authoritative for a single session, but wiring the dropped notification is separate work that would additionally surface subagent activity.

## Consequences

**Bought**: aborted or interrupted streams read as finished replies immediately, self-repairing on relaunch; the working indicator spans the whole turn for every reply shape. **Paid**: a finalized partial reply is a prefix of what the model intended — marked as a normal finished message, with no visual "interrupted" affordance yet.

## Testing

`finalizeStream` behavior is pinned by projection tests over stored event sequences ending in `step/end`/`turn/end`; working-state transitions are pinned by two `SessionControllerTests` cases covering send → `turn/start` → `turn/end` and delivery failure. Verified end-to-end against the running app's wire log.
