# Agent Note: Settle a pending cancel with the load it races

Status: implemented

English | [中文](2026-08-16-sdk-cancel-load-settlement.zh.md)

## Problem

[`session/cancel`](../feature/2026-08-15-sdk-session-cancel.md) tracked a cancel that arrived during an in-flight load in a session-keyed `Set<string>`, while the load lifecycle itself lived in `sessionCreations`. Two operations therefore owned one piece of cancellation state, and [`session/resume`](../feature/2026-08-15-sdk-session-resume.md) added a third path through it: a `session/prompt` waiting on a resume lazily creates when that resume fails.

A cancel that raced a failing resume was lost. The waiting prompt registered its rejection handler first, so it started the lazy create before `cancel` ran its own rejection handler, which deleted the marker the prompt's post-enqueue step was about to consume. `session/cancel` returned `{}` and the freshly created session ran the queued message — the same client-visible failure the in-flight-create cancel was written to prevent.

A cancel that raced a succeeding resume was never cleared. The fulfilled branch aborted the live agent but left the marker in the set, and the next unrelated `session/prompt` consumed it and cancelled a turn the client never asked to cancel.

The fulfilled branch also aborted the agent while a waiting prompt still had to enqueue, so an ordinary create-then-cancel called `agent.cancel` twice.

## Decision

The cancel intent is a field on the load it races, not session-keyed state beside it: `PendingSessionLoad` carries `cancelled`, `promptWaiters`, and `cancelWaiters`, and a `SessionRecord` carries `pendingCancel` and `waitingPrompts` from the moment its load settles.

A cancel covers the prompts that were already waiting on the load when it arrived, and only those. `session/cancel` snapshots `promptWaiters` into `cancelWaiters`, and settlement transfers that snapshot rather than the live count. A prompt that joins afterwards was sent after the cancel, and reaction-registration order puts the covered prompts' enqueues ahead of it, so the abort lands between them.

A load that settles successfully hands its cancel to the record. The party that completes the operation applies it, at most once: the last covered `session/prompt` once every covered prompt has finished its enqueue attempt, because `agent.cancel` does not arm later work and a covered prompt that enqueues after the abort would run; a load with no prompt waiting at cancel time is completed by the `session/cancel` call itself. Waiters are counted rather than flagged — one boolean cannot say whether a second prompt joined the same load and still owes an enqueue.

The count retires enqueue *attempts*, not enqueues: a prompt whose live-agent validation throws never calls `followup`, and its `finally` still retires its obligation. Holding the count until an actual enqueue would strand the cancel whenever validation, message construction, or `followup` throws.

A load that fails hands its cancel to whatever continues the operation. The lazy create a waiting prompt starts inherits both the intent and its coverage through `beginSessionLoad`'s `inherited` argument. A failed load that nothing continues drops the intent with the record that was never built, so an independent later retry is unaffected — and nothing is aborted at all, which is the third outcome the READMEs state.

## Alternatives considered

**Keep the set and stop deleting on load failure.** Rejected: the delete exists so a failed load does not poison a later independent retry. Without generation scoping, keeping the marker trades a dropped cancel for a stolen one.

**Keep a boolean for the waiting prompt instead of a count.** Rejected: with two prompts joined to one load, the first to enqueue consumes the only apply and the second enqueues after the abort, so a message the client sent before the cancel runs. That is the reported defect's own shape, one waiter along.

**Wait for the live waiter count rather than a snapshot.** Rejected: a prompt that joins the load after the cancel then also holds the abort back, and the abort lands on an inbox that already contains that prompt's message — the client is handed a `messageId` for a message that is then silently discarded by a cancel it preceded. It also splits behaviour on something no client can observe, since the same sequence on a live session leaves the later prompt alone.

**Carry an inherited intent onto a load that is already under way.** Rejected as state with no need: the only continuation that inherits an intent builds the successor itself, and every sibling continuing the same failed load reads the same intent in the same microtask drain, so the entry already holds it. The carry executed but could not change an outcome.

**Guard the window between record publication and the waiting prompt's enqueue.** `createSession` publishes into `sessions` before its load settles, so `session/cancel` could in principle take the live-session path and abort before that prompt enqueues. Rejected as unreachable: every hop from publication to `followup` is a microtask, and a cancel delivered as a macrotask, as any transport delivers a frame, lands after it. A guard here would be a permanent fixture for an edge case no caller can produce.

**Split the set into `resume:` and `create:` keys.** Rejected: `session/cancel` locates an in-flight load by bare session id, so a split key cannot be read at the point that needs it.

**Apply the cancel at load settlement in every case.** Rejected: it lands before the waiting prompt enqueues, and `agent.cancel` does not arm later work, so the queued message would still run.

## Consequences

**Bought**: one settlement point owns the cancel of one load. A cancel racing any load outcome resolves to at most one `agent.cancel`, placed after every prompt it covers has finished enqueueing and before any prompt sent after it, or to none when the operation it raced never completed. A session that is loading and a session that is live answer a cancel the same way, so the client's own ordering decides what is aborted.

**Paid**: `beginSessionLoad` takes an inheritance argument, so the cancel intent of a failed resume is visible in the successor's construction rather than in a shared map. `session/prompt` reads whether its session was already live before awaiting, because only a prompt that waited on a load owes that load an enqueue — a coupling with `beginSessionLoad`'s own `sessions` read, which is why the count is clamped rather than trusted.

## Testing

Keyless unit: `cancels the lazy create a prompt starts after the resume it was waiting on fails` fails without the inheritance argument. `does not carry a cancel of a resumed session into the next prompt` fails when a settled load leaves its intent behind. `cancels only after every prompt that joined one in-flight create has enqueued` and `cancels only after every prompt that joined a failing resume has enqueued` fail when waiters are a boolean rather than a count. `leaves a prompt that arrives after the cancel out of that cancel` and `leaves a prompt that arrives after the cancel out of an inherited lazy create` fail when the abort waits on the live waiter count instead of the snapshot taken at cancel time. `cancels a session whose lazy creation is still in flight` pins a single `agent.cancel`. `does not keep a pending cancel after lazy creation fails` keeps a later independent prompt uncancelled.
