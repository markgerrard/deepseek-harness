# Agent Note: DS Bot drag zones, hover message actions, and streaming render cost

Status: implemented

English | [中文](2026-08-21-ds-bot-chat-interaction-polish.zh.md)

## Problem

Three chat-surface defects: dragging to select text in a short message moved the window, because the window was background-movable and a window-drag view sat behind the entire root; messages offered no copy affordance; and a multi-thousand-word streaming reply wedged the main thread even at a fixed 10Hz render coalesce, because one markdown re-layout of the whole growing bubble outlasts the interval.

## Decision

`isMovableByWindowBackground` is off and the root-level `WindowDragArea` is gone: dragging lives only in the explicit 40pt header strips (sidebar, chat, inspector). Message rows track pointer hover and reveal a Grok Bot-style action row — copy with a checkmark acknowledgment plus an ellipsis menu — to the right of bot bubbles and the left of user bubbles, opacity-hidden when idle so revealing never reflows. Streaming bubbles render plain selectable text and switch to full markdown only when the message finalizes, and the render-coalescing interval scales with the projector's buffered stream length: 100ms to 4k characters, 250ms to 12k, 500ms beyond.

## Alternatives considered

**Incremental markdown layout of only the appended tail.** Rejected for now: SwiftUI's Text/AttributedString has no stable append seam; plain streaming text plus finalize-time markdown gets the bound without a custom layout engine.

**A fixed slower interval instead of scaling.** Rejected: it punishes short replies, which render comfortably at 10Hz; cost tracks bubble length, so the interval should too.

**Context menu on right-click only.** Rejected: the reference product (Grok Bot) reveals actions on hover beside the bubble; discoverability was the point of the request.

## Consequences

**Bought**: text selection works everywhere outside the header strips; every finished message is copyable from a hover affordance; arbitrarily long streams keep the main thread ahead of its own layout work.

**Paid**: markdown formatting appears only when a streaming message completes, and window dragging requires the header strips.

## Testing

`testStreamRenderIntervalScalesWithLength` pins the interval thresholds; the coalescing test pins chunk-versus-durable bump behavior. Hover reveal and drag zones are view-layer wiring verified in the running app.
