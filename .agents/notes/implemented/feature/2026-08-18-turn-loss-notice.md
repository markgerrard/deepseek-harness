# Agent Note: turn-loss notice — tell the model a failed turn's streamed answer was not retained

Status: implemented

English | [中文](2026-08-18-turn-loss-notice.zh.md)

## Problem

A turn that errors mid-stream commits `turn/end {kind:'error'}` and its `assistant/chunk` trail, but no `assistant/message` — the surface projection derives model history from message-producing events only, so the model's next request jumps from the user's question to their next prompt. The user, meanwhile, watched the partial answer stream. The asymmetry surfaced in production use (2026-08-18): a user asked about "the call you reviewed"; the model had no record of reviewing any call, re-derived honestly, and picked a different one. The failure mode without a fix is worse than re-derivation: asked "as you said earlier", a model with a silent hole either confabulates a plausible earlier statement or contradicts itself, both while sounding certain.

## Decision

A config-less context plugin (`@deepseek-ai/dsh-turn-loss-notice`) derives the loss at the next turn's first entered step and prepends one producer-framed `<system-reminder>` user message: the previous response failed mid-stream and was not retained. The predicate — the log's most recent `turn/end` is `{kind:'error'}` and that turn holds a `text-delta` chunk later than its last content-bearing `assistant/message` — reads the session log only, so the mechanism is stateless and restart-proof, and consecutive failed retries re-trigger exactly when a new loss occurred. Delivery rides `agent/pre-step` prepend, which the loop commits as an injected `user/message` before the model call: durably logged even if the carrying turn also dies, and ahead of the user's prompt in both log and request. Trigger semantics and the model-visible text are pinned in the package README's Model Experience section.

## Alternatives considered

- **Append the notice at error time from a `session/event` listener** (the design's r1). Rejected: it must litigate append-during-append reentrancy, needs its own dedupe rule for consecutive failures, and writes a notice nobody may ever read (a conversation that simply ends). The pre-step derivation keeps r1's durability — decision messages commit before the model call — and adds statelessness.
- **Auto-commit partial turns.** Rejected: a half-finished answer as committed history invites the model to build on unverified fragments; a blank asks, a lossy record asserts.
- **DB-seeded context rebuild on resume-miss.** Rejected: rebuilt context excludes tool results, so the model would see its own past claims with no underlying data — confabulation-by-replay.
- **Any-chunk trigger instead of `text-delta`.** Rejected on measurement: about a third of real chunk traffic is tool-call structure, and turns routinely open with a tool-call block — an error before any prose is the common timing and must stay silent (the user saw nothing).

## Consequences

Cost: one ~70-token retained context message per actual loss, and a full log scan at each turn's first entered step (bounded by session length; the same full-scan pattern agent-instructions already uses). Bought: "as you said earlier" now gets "I don't have that, let me redo it" instead of confabulation, and the honest asymmetry — the user may have seen what the model cannot remember — is stated to the one party that cannot otherwise know it. The crash path (no `turn/end` at all) remains uncovered by construction; that domain belongs to session repair's synthetic closers, recorded in the package README so the predicate is not widened toward a shape it cannot match.

## Testing

Eleven behavior tests drive a real agent loop against scripted adapters: the positive loss shape (notice content, source, log-and-request ordering ahead of the prompt), the negatives (completed turn, pre-stream error, reasoning-only loss, tool-call-delta-only loss, committed-tail multi-step error, user abort with uncommitted text), the multi-step lost-tail positive, cross-turn anchoring (an earlier turn's commit does not mask the errored turn's loss), and consecutive-failure re-triggering. The abort and tool-call-delta negatives are mutation-derived: each is the only test that fails when its conjunct is dropped.
