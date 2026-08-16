# Agent Note: Settle a pending cancel with the load it races

Status: implemented

English | [中文](2026-08-16-sdk-cancel-load-settlement.zh.md)

## Problem

[`session/cancel`](../feature/2026-08-15-sdk-session-cancel.md) tracked a cancel that arrived during an in-flight load in a session-keyed `Set<string>`, while the load lifecycle itself lived in `sessionCreations`. Two operations therefore owned one piece of cancellation state, and [`session/resume`](../feature/2026-08-15-sdk-session-resume.md) added a third path through it: a `session/prompt` waiting on a resume lazily creates when that resume fails.

A cancel that raced a failing resume was lost. The waiting prompt registered its rejection handler first, so it started the lazy create before `cancel` ran its own rejection handler, which deleted the marker the prompt's post-enqueue step was about to consume. `session/cancel` returned `{}` and the freshly created session ran the queued message — the same client-visible failure the in-flight-create cancel was written to prevent.

A cancel that raced a succeeding resume was never cleared. The fulfilled branch aborted the live agent but left the marker in the set, and the next unrelated `session/prompt` consumed it and cancelled a turn the client never asked to cancel.

The fulfilled branch also aborted the agent while a waiting prompt still had to enqueue, so an ordinary create-then-cancel called `agent.cancel` twice.

## Decision

The cancel intent is a field on the load it races, not session-keyed state beside it: `PendingSessionLoad` carries `cancelled` and `promptWaiting`, and a `SessionRecord` carries `pendingCancel` from the moment its load settles.

A load that settles successfully hands its cancel to the record. Whichever party completes the operation applies it exactly once: a waiting `session/prompt` after it enqueues, because `agent.cancel` does not arm later work, and otherwise the `session/cancel` call itself.

A load that fails hands its cancel to whatever continues the operation. The lazy create a waiting prompt starts inherits it through `beginSessionLoad`'s `inheritedCancel` argument; a failed load that nothing continues drops the intent with the record that was never built, so an independent later retry is unaffected.

## Alternatives considered

**Keep the set and stop deleting on load failure.** Rejected: the delete exists so a failed load does not poison a later independent retry. Without generation scoping, keeping the marker trades a dropped cancel for a stolen one.

**Split the set into `resume:` and `create:` keys.** Rejected: `session/cancel` locates an in-flight load by bare session id, so a split key cannot be read at the point that needs it.

**Apply the cancel at load settlement in every case.** Rejected: it lands before the waiting prompt enqueues, and `agent.cancel` does not arm later work, so the queued message would still run.

## Consequences

**Bought**: one settlement point owns the cancel of one load. A cancel racing any load outcome resolves to exactly one `agent.cancel`, or to none when the operation it raced never completed.

**Paid**: `beginSessionLoad` takes an inheritance argument, so the cancel intent of a failed resume is visible in the successor's construction rather than in a shared map.

## Testing

Keyless unit: `cancels the lazy create a prompt starts after the resume it was waiting on fails` fails without the inheritance argument. `does not carry a cancel of a resumed session into the next prompt` fails when a settled load leaves its intent behind. `cancels a session whose lazy creation is still in flight` now pins a single `agent.cancel`. `does not keep a pending cancel after lazy creation fails` keeps a later independent prompt uncancelled.
