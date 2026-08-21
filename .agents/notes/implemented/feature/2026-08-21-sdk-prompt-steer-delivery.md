# Agent Note: SDK prompts steer a running turn by default in DS Bot

Status: implemented

English | [中文](2026-08-21-sdk-prompt-steer-delivery.zh.md)

## Problem

DS Bot has no stop control, and `session/prompt` always delivered through `agent.followup()`, so every message sent while a bot was mid-turn queued a whole new turn behind the running one. A user watching a bot go down the wrong path could neither stop it nor redirect it — their correction waited until the runaway turn finished and then started another turn on stale intent.

## Decision

`SessionPromptParams` carries an optional `steer` flag. `steer: true` delivers through `agent.steer()`: a running driver consumes the message at its next step boundary, and an idle driver starts a turn, so steering is always safe to send. Omitted or `false` keeps `followup()` queued-turn delivery. Prompts queued behind an in-flight lazy create or resume replay with the same delivery they were sent with. The DS Bot `HarnessClient.prompt` defaults `steer` to `true`, and when the thread is visibly working the app follows the accepted prompt with `session/cancel { keepInbox: true }`: steering alone is consumed only at the next step boundary, which a single long text generation never reaches, so the keepInbox abort ends the in-flight step while the steering wake and message survive and replay into a fresh turn that answers the redirect immediately. SDK callers that want strict turn queueing pass `steer: false` or omit the flag at the wire level.

## Alternatives considered

**A separate `session/steer` method.** Rejected: delivery placement is a property of one prompt, not a different operation — a second method would duplicate the queue-replay, lazy-create, and shutdown paths for no wire benefit.

**Steer only when the session is currently running.** Rejected: the client's view of running is racy; `agent.steer()` already degrades to starting a turn when idle, so an unconditional default avoids a wire round-trip and a race window.

**An app-side stop button instead.** Complementary, not competing: the composer shows a stop control while a turn runs (`SessionController.stopCurrentTurn()` sends `session/cancel`); steering removes the common need to stop at all by making the next message the correction.

## Consequences

**Bought**: messages sent to a busy DS Bot redirect it at the next step boundary; nothing new queues behind runaway turns by default.

**Paid**: a DS Bot user can no longer intentionally queue a followup turn behind a running one from the app; the wire keeps that ability (`steer` omitted), so it is an app-surface gap, not a protocol one. A steering message rejected by the step parks in the inbox until the next wake, per the agent contract.

## Testing

`packages/sdk/server/tests/server.spec.ts` pins steer delivery on live sessions, followup on omission, and steer preservation through lazy-create queue replay. `SessionControllerTests.testPromptSteersByDefault` pins `steer: true` on the app's recorded wire params through the bundled fake runtime.

## Deferred

A keyless snapshot of steer delivery through the jsonrpc-agent example: mid-turn steering is timing-dependent under replay, and an idle-steer scenario needs a keyed recording pass; the wire and app behavior are pinned by the package and Swift tests above until then.
