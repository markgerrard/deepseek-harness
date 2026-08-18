/**
 * Claude Code-like status footer: `? for shortcuts`, model, cwd, and
 * ephemeral notices.
 * @module @deepseek-ai/dsh-tui/status
 */

import { providerDisplayName } from './connect.ts'
import { editorHelp } from './keys.ts'
import { ICONS } from './theme.ts'

/** Ephemeral status notice. */
export interface StatusNotice {
  readonly type: 'info' | 'success' | 'warn' | 'error'
  readonly text: string
}

/** Inputs for the status / occupancy chrome. */
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

/** Past-tense cooking verbs rotated onto finished-turn clocks. */
export const COOKING_VERBS = ['Baked', 'Sautéed', 'Crunched', 'Simmered'] as const

/**
 * Pick a culinary past-tense verb for the Nth completed turn.
 * @param index - zero-based completed-turn index.
 * @returns one of {@link COOKING_VERBS}.
 */
export function cookingVerb(index: number): string {
  return COOKING_VERBS[((index % COOKING_VERBS.length) + COOKING_VERBS.length) % COOKING_VERBS.length] ?? 'Crunched'
}

/**
 * Format a turn duration (`12s`, `1m 10s`, `1h 2m 10s`).
 * @param ms - elapsed milliseconds (floored to seconds, never negative).
 * @returns a short duration string.
 */
export function formatTurnDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

/**
 * Live working line shown above the prompt while a turn is running.
 * @param ms - elapsed milliseconds.
 * @param outputTokens - live output token count, when a real measurement exists.
 * @returns `* Working... (1s)` or `* Working... (1s · ↓ 3 tokens)`.
 */
export function formatWorkingLine(ms: number, outputTokens?: number): string {
  const duration = formatTurnDuration(ms)
  if (outputTokens !== undefined && outputTokens > 0) {
    return `* Working... (${duration} · ↓ ${outputTokens} tokens)`
  }
  return `* Working... (${duration})`
}

/**
 * Finished-turn clock that stays in transcript history.
 * @param ms - frozen duration.
 * @param verb - culinary past-tense verb.
 * @returns `✱ Baked for 2s`.
 */
export function formatDoneLine(ms: number, verb: string): string {
  return `${ICONS.clock} ${verb} for ${formatTurnDuration(ms)}`
}


/**
 * Format token occupancy (`42%` or `1.2k`).
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
 * Model line: `provider / model` plus occupancy. No Crush diamond mark.
 * @param status - current model facts.
 * @returns one display line.
 */
export function formatModelLine(status: StatusModel): string {
  const route = `${providerDisplayName(status.provider)} / ${status.model}`
  const occupancy = formatOccupancy(status.usedTokens, status.contextWindow)
  return occupancy === undefined ? route : `${route}  ${occupancy}`
}

/**
 * Help-key fragments for the help overlay.
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
 * Soft-wrap `text` to `width` cells, breaking on spaces when possible.
 * Long words are split rather than ellipsized.
 * @param text - source text (may contain existing newlines).
 * @param width - maximum columns per line.
 * @returns wrapped text.
 */
export function wrapText(text: string, width: number): string {
  if (width <= 0) return ''
  return text.split('\n').map(paragraph => wrapParagraph(paragraph, width)).join('\n')
}

/**
 * Wrap one paragraph to `width`, preferring the last space at or before the edge.
 * @param text - a single paragraph (no newlines).
 * @param width - maximum columns.
 * @returns wrapped lines joined by newline.
 */
function wrapParagraph(text: string, width: number): string {
  if (text.length <= width) return text
  const lines: string[] = []
  let rest = text
  while (rest.length > width) {
    let breakAt = rest.lastIndexOf(' ', width)
    if (breakAt <= 0) breakAt = width
    lines.push(rest.slice(0, breakAt).trimEnd())
    rest = rest.slice(breakAt).trimStart()
  }
  if (rest.length > 0) lines.push(rest)
  return lines.join('\n')
}

/**
 * Compose the Claude Code-like footer: `? for shortcuts` plus model and cwd.
 * A notice overlays the footer when present.
 * @param status - current status facts.
 * @param width - status bar columns.
 * @param home - `$HOME` for path collapsing.
 * @returns one status line.
 */
export function formatStatusLine(status: StatusModel, width: number, home?: string): string {
  if (status.notice !== undefined) {
    const mark = status.notice.type === 'error' ? ICONS.toolError
      : status.notice.type === 'success' ? ICONS.check
        : status.notice.type === 'warn' ? ICONS.toolPending
          : ICONS.spinner
    return truncate(`${mark} ${status.notice.text}`, width)
  }
  const left = '? for shortcuts'
  const right = `${formatModelLine(status)}  ${prettyPath(status.cwd, home)}`
  const pad = Math.max(1, width - left.length - right.length)
  if (left.length + 1 + right.length > width) {
    return truncate(`${left}  ${right}`, width)
  }
  return `${left}${' '.repeat(pad)}${right}`
}

/**
 * Pretty-print a working directory (home as `~`).
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
