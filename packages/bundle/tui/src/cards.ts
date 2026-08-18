/**
 * Claude Code-like chat bubbles and tool cards. Diff meta from DSH tool
 * results is rendered when present; otherwise the card stays a collapsed header.
 * @module @deepseek-ai/dsh-tui/cards
 */

import type { TurnClock } from './state.ts'
import { truncate, wrapText } from './status.ts'
import { COLORS, ICONS } from './theme.ts'
import type { TranscriptItem } from './transcript.ts'

/** Semantic color role for one card fragment. */
export type CardTone =
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'tool'
  | 'success'
  | 'error'
  | 'brand'
  | 'selector'
  | 'muted'
  | 'fg'

/** One colored fragment of a transcript card. */
export interface CardSegment {
  readonly text: string
  readonly tone: CardTone
}

/** One pre-wrapped visual row of a transcript card. */
export interface CardLine {
  readonly segments: readonly CardSegment[]
}

/** One rendered transcript block ready for Ink. */
export interface RenderedCard {
  readonly id: string
  readonly kind: TranscriptItem['kind']
  readonly text: string
  readonly segments: readonly CardSegment[]
  /** Visual rows after {@link wrapText} at {@link cardWrapWidth}. */
  readonly lines: readonly CardLine[]
}

/**
 * Width used for both `wrapText` and the card Box. Transcript cards have no
 * `paddingX`, so this is the transcript band width (`layout.main.width`).
 * @param bandWidth - transcript band columns.
 * @returns at least one column.
 */
export function cardWrapWidth(bandWidth: number): number {
  return Math.max(1, bandWidth)
}

/**
 * Split already-wrapped source into visual rows. An empty string is one blank row.
 * @param text - output of {@link wrapText}.
 * @returns one string per painted row.
 */
export function visualLines(text: string): string[] {
  if (text === '') return ['']
  return text.split('\n')
}

/**
 * Color the prefix on the first visual row only.
 * @param line - one wrap row.
 * @param prefix - mark plus trailing space (`● `, `› `).
 * @param prefixTone - mark color.
 * @param bodyTone - remainder color.
 * @returns one or two segments.
 */
function splitPrefixLine(
  line: string,
  prefix: string,
  prefixTone: CardTone,
  bodyTone: CardTone,
): CardSegment[] {
  const painted = line === '' ? ' ' : line
  if (prefix !== '' && painted.startsWith(prefix)) {
    const rest = painted.slice(prefix.length)
    if (rest === '') return [{ text: prefix, tone: prefixTone }]
    return [{ text: prefix, tone: prefixTone }, { text: rest, tone: bodyTone }]
  }
  return [{ text: painted, tone: bodyTone }]
}

/**
 * Pre-wrap `prefix + body` at `width` and color the prefix on line 0.
 * @param prefix - leading mark.
 * @param prefixTone - mark color.
 * @param body - remaining text (may contain newlines).
 * @param bodyTone - body color.
 * @param width - {@link cardWrapWidth}.
 * @returns visual rows.
 */
function prefixedLines(
  prefix: string,
  prefixTone: CardTone,
  body: string,
  bodyTone: CardTone,
  width: number,
): CardLine[] {
  return visualLines(wrapText(`${prefix}${body}`, width)).map(line => ({
    segments: splitPrefixLine(line, prefix, prefixTone, bodyTone),
  }))
}

/**
 * Pre-wrap a body with a single tone.
 * @param text - source text.
 * @param tone - fragment color.
 * @param width - {@link cardWrapWidth}.
 * @returns visual rows.
 */
function bodyLines(text: string, tone: CardTone, width: number): CardLine[] {
  return visualLines(wrapText(text, width)).map(line => ({
    segments: [{ text: line === '' ? ' ' : line, tone }],
  }))
}

/**
 * Join pre-wrapped rows into the string/segment form older callers expect.
 * @param id - card id.
 * @param kind - transcript kind.
 * @param lines - visual rows.
 * @returns a rendered card.
 */
function cardFromLines(id: string, kind: TranscriptItem['kind'], lines: readonly CardLine[]): RenderedCard {
  const segments: CardSegment[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined) continue
    if (index === 0) {
      segments.push(...line.segments)
      continue
    }
    const [first, ...rest] = line.segments
    if (first === undefined) {
      segments.push({ text: '\n', tone: 'fg' })
      continue
    }
    segments.push({ text: `\n${first.text}`, tone: first.tone }, ...rest)
  }
  return {
    id,
    kind,
    text: lines.map(line => line.segments.map(segment => segment.text).join('')).join('\n'),
    segments,
    lines,
  }
}

/**
 * Map a card tone onto the Claude Code-like palette.
 * @param tone - semantic fragment role.
 * @returns an Ink `color` hex.
 */
export function toneColor(tone: CardTone): string {
  switch (tone) {
    case 'user':
    case 'brand':
      return COLORS.brand
    case 'assistant':
    case 'fg':
      return COLORS.fg
    case 'thinking':
    case 'muted':
      return COLORS.muted
    case 'tool':
      return COLORS.tool
    case 'success':
      return COLORS.success
    case 'error':
      return COLORS.error
    case 'selector':
      return COLORS.selector
    default: {
      const _exhaustive: never = tone
      return _exhaustive
    }
  }
}

/**
 * Tool-status mark tone: green check, red error, purple await, orange pending.
 * @param status - tool card lifecycle.
 * @returns a card tone.
 */
export function toolMarkTone(status: 'running' | 'success' | 'error' | 'awaiting'): CardTone {
  if (status === 'success') return 'success'
  if (status === 'error') return 'error'
  if (status === 'awaiting') return 'selector'
  return 'brand'
}

/** Transcript row after finished-turn clocks are interleaved. */
export type TranscriptRow =
  | { readonly type: 'item'; readonly item: TranscriptItem }
  | { readonly type: 'clock'; readonly clock: TurnClock }

/**
 * Insert frozen `✱ Verb for Ns` clocks after each completed turn.
 * The in-flight turn (when `busy`) does not receive a clock.
 * @param items - projected session rows.
 * @param clocks - completed-turn clocks in order.
 * @param busy - whether a turn is currently running.
 * @returns rows ready for Ink.
 */
export function insertTurnClocks(
  items: readonly TranscriptItem[],
  clocks: readonly TurnClock[],
  busy: boolean,
): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  let turnIndex = -1
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (item === undefined) continue
    if (item.kind === 'user') turnIndex += 1
    rows.push({ type: 'item', item })
    const next = items[index + 1]
    const endOfTurn = next === undefined || next.kind === 'user'
    const clock = clocks[turnIndex]
    const place = endOfTurn && clock !== undefined && (next !== undefined || !busy)
    if (place) rows.push({ type: 'clock', clock })
  }
  if (!busy) {
    const placed = rows.filter(row => row.type === 'clock').length
    for (const clock of clocks.slice(placed)) rows.push({ type: 'clock', clock })
  }
  return rows
}

/**
 * Human-readable Claude Code-like tool title (`Bash command`, `Read`).
 * @param name - raw tool name from the session log.
 * @returns a display title.
 */
export function formatToolTitle(name: string): string {
  const lower = name.toLowerCase()
  if (lower === 'bash' || lower === 'shell' || lower === 'bash_command') return 'Bash command'
  if (lower === 'read' || lower === 'read_file') return 'Read'
  if (lower === 'write' || lower === 'write_file') return 'Write'
  if (lower === 'edit' || lower === 'strreplace' || lower === 'str_replace') return 'Edit'
  if (lower === 'glob') return 'Glob'
  if (lower === 'grep') return 'Grep'
  return name
}

/**
 * Summarize a JSON-ish tool-args string for the card body (command or path).
 * @param args - raw model arguments JSON.
 * @param width - remaining header columns.
 * @returns a short salient snippet.
 */
export function summarizeArgs(args: string, width: number): string {
  const trimmed = args.trim()
  if (trimmed === '' || trimmed === '{}') return ''
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const values = Object.values(parsed as Record<string, unknown>)
      const first = values.find(value => typeof value === 'string' && value.length > 0)
      if (typeof first === 'string') return truncate(first.replace(/\s+/g, ' '), width)
    }
  } catch {
    // Raw model JSON is not a typed boundary we control; fall through to the snippet.
  }
  return truncate(trimmed.replace(/\s+/g, ' '), width)
}

/**
 * Render a unified-ish diff from a DSH tool-result meta payload when it
 * carries `oldText`/`newText` or a `diff` string.
 * @param meta - tool-result meta.
 * @param width - card columns.
 * @returns diff lines, or undefined when meta is not a diff.
 */
export function renderDiff(meta: unknown, width: number): string | undefined {
  if (meta === null || typeof meta !== 'object') return undefined
  const record = meta as Record<string, unknown>
  if (typeof record.diff === 'string' && record.diff.trim() !== '') {
    return wrapText(record.diff, width)
  }
  const oldText = typeof record.oldText === 'string' ? record.oldText : undefined
  const newText = typeof record.newText === 'string' ? record.newText : undefined
  if (oldText === undefined && newText === undefined) return undefined
  const before = (oldText ?? '').split('\n')
  const after = (newText ?? '').split('\n')
  const lines: string[] = []
  const max = Math.max(before.length, after.length)
  for (let index = 0; index < max; index += 1) {
    const left = before[index]
    const right = after[index]
    if (left === right) continue
    if (left !== undefined) lines.push(`- ${left}`)
    if (right !== undefined) lines.push(`+ ${right}`)
  }
  if (lines.length === 0) return undefined
  return wrapText(lines.join('\n'), width)
}

/**
 * Render one Claude Code-like transcript item.
 * Every visual row is pre-wrapped at {@link cardWrapWidth}; Ink must not wrap again.
 * @param item - projected transcript row.
 * @param width - card Box columns (same value passed to the Ink Box).
 * @returns a titled card or bubble.
 */
export function renderCard(item: TranscriptItem, width: number): RenderedCard {
  const wrapWidth = cardWrapWidth(width)
  switch (item.kind) {
    case 'user':
      return cardFromLines(
        item.id,
        item.kind,
        prefixedLines(`${ICONS.user} `, 'user', item.text, 'fg', wrapWidth),
      )
    case 'assistant': {
      const suffix = item.streaming ? ` ${ICONS.spinner}` : ''
      return cardFromLines(
        item.id,
        item.kind,
        prefixedLines(`${ICONS.assistant} `, 'assistant', `${item.text}${suffix}`, 'assistant', wrapWidth),
      )
    }
    case 'reasoning': {
      const label = item.expanded ? 'thinking' : 'thinking (space to expand)'
      const lines = prefixedLines(`${ICONS.spinner} `, 'brand', label, 'thinking', wrapWidth)
      if (item.expanded) lines.push(...bodyLines(item.text, 'thinking', wrapWidth))
      return cardFromLines(item.id, item.kind, lines)
    }
    case 'tool': {
      const mark = item.status === 'success' ? ICONS.toolSuccess
        : item.status === 'error' ? ICONS.toolError
          : item.status === 'awaiting' ? ICONS.selector
            : ICONS.toolPending
      const title = formatToolTitle(item.name)
      const lines = prefixedLines(`${mark} `, toolMarkTone(item.status), title, 'tool', wrapWidth)
      const summary = summarizeArgs(item.args, Math.max(8, wrapWidth - title.length - 4))
      if (summary !== '') lines.push(...prefixedLines('  ', 'muted', summary, 'muted', wrapWidth))
      if (item.expanded) {
        const diff = renderDiff(item.meta, wrapWidth)
        const result = item.result ?? ''
        const extra = [diff, result].filter((part): part is string => part !== undefined && part !== '')
        if (extra.length > 0) lines.push(...bodyLines(extra.join('\n'), 'muted', wrapWidth))
      }
      return cardFromLines(item.id, item.kind, lines)
    }
    case 'command':
      return cardFromLines(
        item.id,
        item.kind,
        prefixedLines(`${ICONS.check} `, 'success', item.text, 'fg', wrapWidth),
      )
    default: {
      const _exhaustive: never = item
      return _exhaustive
    }
  }
}

/**
 * Render a transcript for the Claude Code-like chat pane.
 * @param items - projected rows.
 * @param width - chat columns.
 * @returns joined card text.
 */
export function renderTranscript(items: readonly TranscriptItem[], width: number): string {
  if (items.length === 0) return ''
  return items.map(item => renderCard(item, width).text).join('\n\n')
}

/**
 * Wrapped line count for one transcript card at `width`.
 * @param item - projected transcript row.
 * @param width - card columns.
 * @returns at least one row.
 */
export function estimateCardHeight(item: TranscriptItem, width: number): number {
  return Math.max(1, renderCard(item, width).lines.length)
}

/**
 * Wrapped line count for one interleaved transcript row.
 * Clock lines are a single row; cards use {@link estimateCardHeight}.
 * @param row - item or clock.
 * @param width - card columns.
 * @returns at least one row.
 */
export function estimateTranscriptRowHeight(row: TranscriptRow, width: number): number {
  if (row.type === 'clock') return 1
  return estimateCardHeight(row.item, width)
}

/** Newest-pinned slice of a transcript that may be taller than the viewport. */
export interface PinnedTranscript {
  /** Rows that fit, from the bottom when {@link PinnedTranscript.taller}. */
  readonly rows: readonly TranscriptRow[]
  /** True when the full list is taller than the viewport. */
  readonly taller: boolean
  /** Sum of estimated row heights before pinning. */
  readonly contentHeight: number
  /** Pre-wrapped lines dropped from the top of the first returned row. */
  readonly skipLeadingLines: number
  /** Painted rows after top-clip. Always <= the viewport when the viewport is > 0. */
  readonly visibleHeight: number
}

/**
 * Keep the newest transcript rows that fit in `viewportHeight`.
 * Heights are the pre-wrapped line counts from {@link estimateCardHeight}.
 * Content shorter than the band is left intact. Content taller drops earlier
 * rows; a row that only partially fits keeps its last lines (clips the top).
 * A single card taller than the viewport is kept and top-clipped so the
 * painted height is <= the viewport. Never splits a visual line.
 * @param rows - interleaved cards and clocks (trailing clock already peeled).
 * @param width - card Box columns (same value as wrap / paint).
 * @param viewportHeight - transcript band rows.
 * @returns the visible slice and whether the full list overflowed.
 */
export function pinTranscriptToBottom(
  rows: readonly TranscriptRow[],
  width: number,
  viewportHeight: number,
): PinnedTranscript {
  const wrapWidth = cardWrapWidth(width)
  const heights = rows.map(row => estimateTranscriptRowHeight(row, wrapWidth))
  const contentHeight = heights.reduce((sum, height) => sum + height, 0)
  const limit = Math.max(0, viewportHeight)
  const taller = contentHeight > limit
  if (rows.length === 0) {
    return { rows, taller: false, contentHeight: 0, skipLeadingLines: 0, visibleHeight: 0 }
  }
  if (limit <= 0) {
    return { rows: [], taller, contentHeight, skipLeadingLines: 0, visibleHeight: 0 }
  }
  if (!taller) {
    return { rows, taller: false, contentHeight, skipLeadingLines: 0, visibleHeight: contentHeight }
  }
  let used = 0
  let start = rows.length
  let skipLeadingLines = 0
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const height = heights[index] ?? 1
    if (used + height <= limit) {
      used += height
      start = index
      skipLeadingLines = 0
      continue
    }
    const remaining = limit - used
    if (remaining > 0) {
      skipLeadingLines = height - remaining
      used += remaining
      start = index
    }
    break
  }
  return { rows: rows.slice(start), taller: true, contentHeight, skipLeadingLines, visibleHeight: used }
}
