# Agent Note: DS Bot folds session events incrementally and skips per-chunk persistence

Status: implemented

English | [中文](2026-08-21-ds-bot-incremental-projection.zh.md)

## Problem

Every session event reprojected the complete event list (`projectTranscript` over all events per update) and rewrote the complete transcript file to disk, so a streaming chat paid O(events) CPU and a full serialized write per delta — quadratic over a conversation, and the dominant remaining cost after the presented-window cap.

## Decision

`TranscriptProjector` owns the fold state (items, chunk buffers, open tools, open workflows, streaming turn): `ingest(event)` folds one event in place, and `materialize(expansion:)` returns the presentable items — the folded list with expansion applied as an overlay plus the in-flight streaming tail. Folded items store `expanded: false`; expansion is materialize-time, so toggling a card never refolds events. Item updates go through an id→index map instead of tail scans. `projectTranscript` remains as the one-shot wrapper (fold all, materialize once), so existing callers and tests keep their behavior. `SessionController` keeps one projector per session: `appendEvent` ingests exactly the new event, `setEvents` rebuilds the projector once at hydration, and `assistant/chunk` events skip `persistTranscript` — the next durable event writes the full list, so a crash loses only the unfinalized stream.

## Alternatives considered

**Cache the projected array and invalidate on expansion change.** Rejected: expansion toggles would refold the whole event list; the overlay makes expansion orthogonal to folding.

**Debounce persistence on a timer.** Rejected: a timer adds lifecycle (flush on teardown, cancellation) for the same effect; keying on event durability is stateless and names exactly what is at risk.

## Consequences

**Bought**: a streaming chunk costs one buffer update and no disk write; opening, toggling cards, and streaming in long chats no longer scale with conversation length per update.

**Paid**: `materialize` still copies the folded item array per read (copy-on-write memcpy, no parsing), and `eventsBySession` retains the raw event list alongside the projector for persistence and seq lookups.

## Testing

Existing `TranscriptProjectionTests` pin the fold through the one-shot wrapper; `SessionControllerTests` cover append/hydrate paths and the presented window over the projector; `TranscriptStoreTests.testControllerReloadsPersistedTranscript` covers persistence round-trips.
