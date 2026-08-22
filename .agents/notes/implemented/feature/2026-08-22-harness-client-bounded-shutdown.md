# Agent Note: HarnessClient bounded shutdown

Status: implemented

English | [中文](2026-08-22-harness-client-bounded-shutdown.zh.md)

## Problem

`HarnessClientCore.shutdown()` awaited the `shutdown` RPC with no timeout and then called `Process.waitUntilExit()` unconditionally. A runtime that was slow or never answered — under machine load, or a wedged child — hung teardown forever. The Swift test suite reproduced this as infinite hangs in two different child-spawning tests (`RuntimeProcessTests.testStartTwiceThrows`, `HarnessClientTests.testOnRequestReceivesServerRequest`), each parking on an `XCTWaiter` inside shutdown; which test hung varied run to run, masking the single shared cause.

## Decision

Shutdown is bounded end to end: the best-effort `shutdown` RPC races a 5-second timeout through a resume-once gate (the losing branch is abandoned, not cancelled — an in-flight RPC continuation cannot be interrupted, so awaiting both branches would reintroduce the hang); after handles close, the child gets SIGTERM with a 3-second grace, then SIGKILL; `waitUntilExit()` runs last and reaps promptly after either signal. The fake test runtime gains `FAKE_HANG_SHUTDOWN=1` to simulate an unresponsive child deterministically.

## Alternatives considered

**Cancelling the RPC task on timeout.** Rejected: cancelling does not interrupt an already-suspended continuation, so the group would still await it — abandonment is the only honest race. **Killing without a grace period.** Rejected: SIGTERM lets well-behaved runtimes flush state; three seconds costs nothing on the happy path.

## Consequences

**Bought**: teardown always completes; the full suite is deterministic again (140 tests, ~14s) and a regression test pins the unresponsive-child case at 5–6s instead of ∞. **Paid**: a runtime that needs longer than 5s to acknowledge `shutdown` loses its graceful window and dies by signal; the abandoned losing branch's continuation leaks once per timed-out shutdown.

## Testing

`RuntimeProcessTests.testStopForceKillsUnresponsiveRuntime` drives the new flag: it failed by hanging before the fix and passes in ~5.6s after; the full suite passes with both formerly hanging suites included.
