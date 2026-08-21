# Agent Note: DS Bot presents a capped transcript window with scroll-back paging

Status: implemented

English | [中文](2026-08-21-ds-bot-transcript-window.zh.md)

## Problem

Long DS Bot chats degrade while streaming: the chat view presents the full projected transcript, so every session event rebuilds and rediffs the complete item array, and opening an old chat renders its whole history at once. The projection itself also reprojects all events per update, but the immediately felt cost is the unbounded presented set.

## Decision

`SessionController.presentedChat` caps the presented items at the newest `transcriptWindowSize` (120) per thread and sets `PresentedChat.hasEarlier` when older items exist. `loadEarlierItems()` grows the selected thread's window by one page. The chat view opens anchored to the bottom, shows a top sentinel only while earlier items exist, lazily pages when the sentinel scrolls into view (re-anchoring the previous first item so the viewport does not jump), and autoscroll now keys on the last item's identity so paging in earlier items never yanks the view to the bottom. The full projection stays in memory; the cap bounds SwiftUI diffing and row materialization, not event retention.

## Alternatives considered

**Cap at hydration (load only tail events).** Rejected for this step: projection folds event pairs (chunks into messages, tool calls with results), so an event-level cut needs safe turn boundaries; an item-level window is correct by construction.

**Incremental projection instead.** Complementary, deliberately sequenced second: it removes the O(events) reprojection per streaming chunk, while this change bounds the per-update render set; each pays a different cost.

## Consequences

**Bought**: long chats open bottom-anchored rendering at most one window of rows, and update-time diffing is bounded by the window instead of chat length.

**Paid**: a thread's grown window persists only for the controller's lifetime.

## Testing

`SessionControllerTests.testPresentedChatCapsItemsAndPagesEarlier` pins the cap, `hasEarlier`, the window's newest-suffix contents, and paging to completion.
