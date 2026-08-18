/**
 * Crush-style layout: full (header + sidebar + chat + editor + status) versus
 * compact (sidebar hidden) for modest terminals.
 * @module @deepseek-ai/dsh-tui/layout
 */

import { COMPACT_HEIGHT, COMPACT_WIDTH, EDITOR_MAX_HEIGHT, EDITOR_MIN_HEIGHT, SIDEBAR_WIDTH } from './theme.ts'

/** A rectangular region in terminal cells. */
export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Crush layout regions for one terminal size. */
export interface LayoutAreas {
  /** True when the sidebar is hidden (Crush compact mode). */
  readonly compact: boolean
  readonly header: Rect
  readonly sidebar: Rect | undefined
  readonly main: Rect
  readonly editor: Rect
  readonly status: Rect
}

/**
 * Whether Crush would hide the session sidebar at this size.
 * @param width - terminal columns.
 * @param height - terminal rows.
 * @returns true below Crush's 120x30 breakpoints.
 */
export function isCompact(width: number, height: number): boolean {
  return width < COMPACT_WIDTH || height < COMPACT_HEIGHT
}

/**
 * Clamp the Crush prompt textarea to its min/max height.
 * @param lines - wrapped input line count.
 * @returns editor height in rows.
 */
export function editorHeight(lines: number): number {
  if (lines < EDITOR_MIN_HEIGHT) return EDITOR_MIN_HEIGHT
  if (lines > EDITOR_MAX_HEIGHT) return EDITOR_MAX_HEIGHT
  return lines
}

/**
 * Split a terminal into Crush chrome regions.
 * @param width - terminal columns.
 * @param height - terminal rows.
 * @param inputLines - wrapped input line count used for the editor band.
 * @returns layout rectangles; sidebar is omitted in compact mode.
 */
export function layoutAreas(width: number, height: number, inputLines: number): LayoutAreas {
  const compact = isCompact(width, height)
  const cols = Math.max(width, 1)
  const rows = Math.max(height, 1)
  const headerHeight = compact ? 1 : 2
  const statusHeight = 1
  const editor = editorHeight(inputLines)
  const bodyTop = headerHeight
  const bodyHeight = Math.max(0, rows - headerHeight - editor - statusHeight)
  const sidebarWidth = compact ? 0 : Math.min(SIDEBAR_WIDTH, Math.max(0, cols - 40))
  const mainX = compact ? 0 : sidebarWidth
  const mainWidth = Math.max(0, cols - mainX)
  return {
    compact,
    header: { x: 0, y: 0, width: cols, height: headerHeight },
    sidebar: compact || sidebarWidth === 0
      ? undefined
      : { x: 0, y: bodyTop, width: sidebarWidth, height: bodyHeight },
    main: { x: mainX, y: bodyTop, width: mainWidth, height: bodyHeight },
    editor: { x: 0, y: bodyTop + bodyHeight, width: cols, height: editor },
    status: { x: 0, y: rows - statusHeight, width: cols, height: statusHeight },
  }
}
