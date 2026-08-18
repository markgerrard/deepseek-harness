/**
 * Claude Code-like layout: single-column transcript with the prompt pinned
 * at the bottom. Sidebar/header Crush chrome is omitted; compact breakpoints
 * stay exported for unused-width checks.
 * @module @deepseek-ai/dsh-tui/layout
 */

import { COMPACT_HEIGHT, COMPACT_WIDTH, EDITOR_MAX_HEIGHT, EDITOR_MIN_HEIGHT, TRANSCRIPT_PROMPT_GAP } from './theme.ts'

/** A rectangular region in terminal cells. */
export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Claude Code-like layout regions for one terminal size. */
export interface LayoutAreas {
  /** True below the leftover compact breakpoints (sidebar stays hidden either way). */
  readonly compact: boolean
  readonly header: Rect
  readonly sidebar: Rect | undefined
  readonly main: Rect
  readonly editor: Rect
  readonly status: Rect
}

/**
 * Whether the leftover compact breakpoints fire at this size.
 * @param width - terminal columns.
 * @param height - terminal rows.
 * @returns true below 120x30.
 */
export function isCompact(width: number, height: number): boolean {
  return width < COMPACT_WIDTH || height < COMPACT_HEIGHT
}

/**
 * Clamp the prompt textarea to its min/max height.
 * @param lines - wrapped input line count.
 * @returns editor height in rows (includes the round-border pair).
 */
export function editorHeight(lines: number): number {
  if (lines < EDITOR_MIN_HEIGHT) return EDITOR_MIN_HEIGHT
  if (lines > EDITOR_MAX_HEIGHT) return EDITOR_MAX_HEIGHT
  return lines
}

/**
 * Split a terminal into Claude Code-like regions: transcript, prompt, footer.
 * Reserves {@link TRANSCRIPT_PROMPT_GAP} blank rows immediately above the prompt.
 * A second gap plus the clock/Working line (when shown) is taken from the transcript band.
 * Header and sidebar are reserved as empty / omitted.
 * @param width - terminal columns.
 * @param height - terminal rows.
 * @param inputLines - wrapped input line count used for the editor band.
 * @returns layout rectangles; sidebar is always omitted.
 */
export function layoutAreas(width: number, height: number, inputLines: number): LayoutAreas {
  const compact = isCompact(width, height)
  const cols = Math.max(width, 1)
  const rows = Math.max(height, 1)
  const headerHeight = 0
  const statusHeight = 1
  const editor = editorHeight(inputLines)
  const gap = TRANSCRIPT_PROMPT_GAP
  const bodyHeight = Math.max(0, rows - headerHeight - editor - statusHeight - gap)
  return {
    compact,
    header: { x: 0, y: 0, width: cols, height: headerHeight },
    sidebar: undefined,
    main: { x: 0, y: headerHeight, width: cols, height: bodyHeight },
    editor: { x: 0, y: headerHeight + bodyHeight + gap, width: cols, height: editor },
    status: { x: 0, y: rows - statusHeight, width: cols, height: statusHeight },
  }
}
