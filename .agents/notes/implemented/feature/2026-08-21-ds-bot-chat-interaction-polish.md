# Agent Note: DS Bot drag zones, hover message actions, and streaming render cost

Status: implemented

English | [中文](2026-08-21-ds-bot-chat-interaction-polish.zh.md)

## Problem

Three chat-surface defects: dragging to select text in a short message moved the window, because the window was background-movable and a window-drag view sat behind the entire root; messages offered no copy affordance; and a multi-thousand-word streaming reply wedged the main thread even at a fixed 10Hz render coalesce, because one markdown re-layout of the whole growing bubble outlasts the interval.

## Decision

`isMovableByWindowBackground` is off and the root-level `WindowDragArea` is gone: dragging lives only in the explicit 40pt header strips (sidebar, chat, inspector). Message rows track pointer hover and reveal a Grok Bot-style action row — copy with a checkmark acknowledgment plus an ellipsis menu — to the right of bot bubbles and the left of user bubbles, opacity-hidden when idle so revealing never reflows. Streaming renders the way the reference product does — paragraph by paragraph: `splitSettledTail` divides the stream at its last blank-line boundary (never inside an open code fence), each settled paragraph renders as its own `.equatable()` markdown subview so a completing paragraph appends one view instead of rebuilding earlier ones, and only the in-progress tail re-renders per chunk. The coalescing interval keys on that tail — 100ms, 250ms past 4k characters, 500ms past 12k — so ordinary prose stays responsive and only text that never breaks into paragraphs backs off. Hover actions stay visible while their popover is open, and the row makes its full width hit-testable so moving from a bubble toward its actions does not drop the hover.

## Alternatives considered

**One markdown view over the whole streaming text.** Rejected: its body re-evaluates every chunk, rebuilding every paragraph's attributed text, which is what wedged the main thread on a 3000-word reply. Splitting at settled paragraph boundaries gives the same rendered result with per-chunk cost proportional to one paragraph.

**A fixed slower interval instead of scaling.** Rejected: it punishes short replies, which render comfortably at 10Hz; cost tracks bubble length, so the interval should too.

**Context menu on right-click only.** Rejected: the reference product (Grok Bot) reveals actions on hover beside the bubble; discoverability was the point of the request.

## Consequences

**Bought**: text selection works everywhere outside the header strips; every finished message is copyable from a hover affordance; arbitrarily long streams keep the main thread ahead of its own layout work.

**Paid**: a paragraph renders unformatted until its blank-line boundary arrives, and window dragging requires the header strips.

## Testing

`splitSettledTail` tests pin paragraph-boundary splitting, the no-boundary case, and open/closed code fences; `testStreamingTailLengthCountsOnlyTheUnsettledParagraph` pins the projector's tail measure; `testStreamRenderIntervalScalesWithLength` pins the interval thresholds; the coalescing test pins chunk-versus-durable bump behavior. Hover reveal and drag zones are view-layer wiring verified in the running app.
