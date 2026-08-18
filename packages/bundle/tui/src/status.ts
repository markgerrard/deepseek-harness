/**
 * Crush-style status line: help keys, model/cwd/token occupancy, and
 * ephemeral notices.
 * @module @deepseek-ai/dsh-tui/status
 */

import { editorHelp } from './keys.ts'
import { ICONS } from './theme.ts'

/** Ephemeral Crush status notice. */
export interface StatusNotice {
  readonly type: 'info' | 'success' | 'warn' | 'error'
  readonly text: string
}

/** Inputs for the Crush status / occupancy chrome. */
export interface StatusModel {
  readonly provider: string
  readonly model: string
  readonly cwd: string
  readonly usedTokens?: number
  readonly contextWindow?: number
  readonly busy: boolean
  readonly compact: boolean
  readonly notice?: StatusNotice
}

/**
 * Format Crush-style token occupancy (`42%` or `1.2k/128k`).
 * @param used - measured or projected tokens.
 * @param window - model context window when known.
 * @returns a short occupancy string, or undefined when unused.
 */
export function formatOccupancy(used: number | undefined, window: number | undefined): string | undefined {
  if (used === undefined) return undefined
  if (window !== undefined && window > 0) {
    const pct = Math.min(100, Math.round((used / window) * 100))
    return `${pct}%`
  }
  return formatCount(used)
}

/**
 * Compact token/count display (`1.2k`, `128k`).
 * @param value - non-negative count.
 * @returns a short decimal string.
 */
export function formatCount(value: number): string {
  if (value < 1000) return String(value)
  if (value < 10_000) return `${(value / 1000).toFixed(1)}k`
  return `${Math.round(value / 1000)}k`
}

/**
 * Crush header/sidebar model line: `◇ provider / model` plus occupancy.
 * @param status - current model facts.
 * @returns one display line.
 */
export function formatModelLine(status: StatusModel): string {
  const route = `${status.provider} / ${status.model}`
  const occupancy = formatOccupancy(status.usedTokens, status.contextWindow)
  return occupancy === undefined
    ? `${ICONS.model} ${route}`
    : `${ICONS.model} ${route}  ${occupancy}`
}

/**
 * Crush status-bar help text (`ctrl+p commands  ctrl+l models  …`).
 * @param compact - whether the terminal is in compact layout.
 * @returns a single help line.
 */
export function formatHelpLine(compact: boolean): string {
  return editorHelp(compact).map(item => `${item.key} ${item.label}`).join('  ')
}

/**
 * Truncate a string to `width` cells, appending an ellipsis when needed.
 * @param text - source text.
 * @param width - maximum columns.
 * @returns the truncated text.
 */
export function truncate(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  if (width === 1) return '…'
  return `${text.slice(0, width - 1)}…`
}

/**
 * Compose the Crush status bar: a notice overlays help when present.
 * @param status - current status facts.
 * @param width - status bar columns.
 * @returns one status line.
 */
export function formatStatusLine(status: StatusModel, width: number): string {
  if (status.notice !== undefined) {
    const mark = status.notice.type === 'error' ? ICONS.toolError
      : status.notice.type === 'success' ? ICONS.check
        : status.notice.type === 'warn' ? ICONS.toolPending
          : ICONS.spinner
    return truncate(`${mark} ${status.notice.text}`, width)
  }
  const help = formatHelpLine(status.compact)
  const busy = status.busy ? `${ICONS.spinner} ` : ''
  return truncate(`${busy}${help}`, width)
}

/**
 * Pretty-print a working directory for Crush chrome (home as `~`).
 * @param cwd - absolute path.
 * @param home - `$HOME` to collapse, when known.
 * @returns a display path.
 */
export function prettyPath(cwd: string, home: string | undefined): string {
  if (home !== undefined && (cwd === home || cwd.startsWith(`${home}/`))) {
    return `~${cwd.slice(home.length)}`
  }
  return cwd
}
