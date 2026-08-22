# Agent Note: DS Bot composer, paste cards, prose selection, and user settings

Status: implemented

English | [中文](2026-08-22-ds-bot-composer-paste-cards-and-user-settings.zh.md)

## Problem

The chat input could not support three requested behaviors: pastes over a threshold had to become removable cards (claude.ai-style) instead of dumping thousands of characters into the field, Return/Shift+Return needed send-vs-newline semantics, and the input had to grow with its draft like the reference product — at rest a single-line capsule with inline controls, growing into a tall card with controls on a bottom row. Separately, text selection inside assistant replies died at paragraph gaps, the sidebar showed no bot titles, and there was no user identity: no profile footer, and an orphaned account sheet.

## Decision

The composer is an `NSViewRepresentable` over `NSTextView` (`ComposerTextView`): key-down routes bare Return to send and Shift+Return to a newline; `paste:`/`pasteAsPlainText:` route pastes over `AttachmentStore.pasteChipCharacterLimit` (1,200 chars) to a card instead of the field; a delegate publishes laid-out content height so SwiftUI owns the frame (cap 220pt). The container interpolates one `RoundedRectangle`'s corner radius between capsule (>34pt = expanded) and card, so the morph animates. Paste cards render as fixed 120×110 excerpt thumbnails in a horizontal row inside the composer; on send each block joins the wire prompt via `AttachmentStore.pastedTextSuffix` as numbered labeled fences. Prose blocks render as one `Text` per block (paragraphs joined with explicit `\n\n`) because SwiftUI selection is per-Text-instance; streaming keeps per-paragraph rendering for layout cost. Sidebar rows show `Bot.title` as a truncating chip before a fixed-width timestamp; the user footer reads persisted `userName` (default "Mark", blank-tolerant) through `AppSettingsStore`, opening an upward popover whose only entry opens the tabbed `UserSettingsSheet` (General / Providers / API keys).

## Alternatives considered

**SwiftUI `TextField(axis:)` + `onPasteCommand`.** Rejected: while a text view is focused, AppKit consumes ⌘V and the command never fires; paste interception requires owning the `NSTextView`. **Per-paragraph selectable `Text`s with cross-view drag.** Not expressible: selection cannot leave a Text instance — hence the merged block. **Menu for attach/settings popovers.** Rejected twice: AppKit menu-item rendering drops label decorations (the plus ring vanished) and placement is uncontrollable; plain Button + popover with explicit `arrowEdge` replaced both.

## Consequences

**Bought**: all three composer behaviors in one owner; selection across paragraphs in finished replies; visible bot titles; real user identity driving avatar initial. **Paid**: IME edge cases now flow through custom key handling; placeholder alignment depends on zeroed `lineFragmentPadding`; a finished reply's code fences still end selection ranges; sidebar title chips truncate rather than grow the name column.

## Testing

Unit-tested: paste threshold boundary, suffix composition, `userName` default/persistence/trim fallback (DsBotCoreTests). View wiring (keys, paste routing, growth, popover direction) is verified in the running app per convention.
