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
      const label = item.expanded ? 'thinking' : 'thinking (ctrl+o to expand)'
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
    case 'workflow': {
      const mark = item.status === 'success' ? ICONS.toolSuccess
        : item.status === 'error' ? ICONS.toolError
          : ICONS.toolPending
      const title = `workflow: ${item.name}`
      const lines = prefixedLines(`${mark} `, toolMarkTone(item.status), title, 'tool', wrapWidth)
      const summary = `${item.members.length} member${item.members.length === 1 ? '' : 's'}`
      lines.push(...prefixedLines('  ', 'muted', summary, 'muted', wrapWidth))
      if (item.expanded) {
        const body = item.members.length === 0
          ? 'no members yet'
          : item.members.map(member => {
            const phase = member.phase === undefined ? '' : ` · ${member.phase}`
            return `${member.label}${phase}  ${member.status}`
          }).join('\n')
        lines.push(...bodyLines(body, 'muted', wrapWidth))
      }
      return cardFromLines(item.id, item.kind, lines)
    }
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

/** Pin-to-bottom vs a held start line after PageUp. */
export interface TranscriptScroll {
  /** True when the viewport follows new output. */
  readonly pinned: boolean
  /** Top visual line of the window when unpinned. */
  readonly startLine: number
}

/** Newest-pinned (or scrolled) slice of a transcript that may be taller than the viewport. */
export interface PinnedTranscript {
  /** Rows that fit, from the bottom when pinned. */
  readonly rows: readonly TranscriptRow[]
  /** True when the full list is taller than the viewport. */
  readonly taller: boolean
  /** Sum of estimated row heights before pinning. */
  readonly contentHeight: number
  /** Pre-wrapped lines dropped from the top of the first returned row. */
  readonly skipLeadingLines: number
  /** Pre-wrapped lines dropped from the bottom of the last returned row. */
  readonly skipTrailingLines: number
  /** Painted rows after clip. Always <= the viewport when the viewport is > 0. */
  readonly visibleHeight: number
  /** Clamped top line of the painted window. */
  readonly startLine: number
  /** True when the window is at the newest lines. */
  readonly pinned: boolean
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
  return clipTranscript(rows, width, viewportHeight, { pinned: true, startLine: 0 })
}

/**
 * Clamp a start line into the scrollable range.
 * @param contentHeight - pre-wrapped line count.
 * @param viewportHeight - transcript band rows.
 * @returns the maximum start line (0 when content fits).
 */
export function maxTranscriptStart(contentHeight: number, viewportHeight: number): number {
  return Math.max(0, contentHeight - Math.max(0, viewportHeight))
}

/**
 * Page the transcript window. Negative delta (PageUp) unpins; reaching the
 * bottom re-pins so new output follows again.
 * @param contentHeight - pre-wrapped line count.
 * @param viewportHeight - transcript band rows.
 * @param scroll - current pin / start.
 * @param delta - visual lines to move (negative = older).
 * @returns the next scroll.
 */
export function pageTranscript(
  contentHeight: number,
  viewportHeight: number,
  scroll: TranscriptScroll,
  delta: number,
): TranscriptScroll {
  const maxStart = maxTranscriptStart(contentHeight, viewportHeight)
  const current = scroll.pinned ? maxStart : Math.min(maxStart, Math.max(0, scroll.startLine))
  const next = Math.min(maxStart, Math.max(0, current + delta))
  if (next >= maxStart) return { pinned: true, startLine: maxStart }
  return { pinned: false, startLine: next }
}

/**
 * Clip a transcript to `viewportHeight` starting at the pinned bottom or at
 * `scroll.startLine`. Never splits a visual line. New output does not move an
 * unpinned window (the start line stays put).
 * @param rows - interleaved cards and clocks (trailing clock already peeled).
 * @param width - card Box columns (same value as wrap / paint).
 * @param viewportHeight - transcript band rows.
 * @param scroll - pin / start-line.
 * @returns the visible slice and clip amounts.
 */
export function clipTranscript(
  rows: readonly TranscriptRow[],
  width: number,
  viewportHeight: number,
  scroll: TranscriptScroll,
): PinnedTranscript {
  const wrapWidth = cardWrapWidth(width)
  const heights = rows.map(row => estimateTranscriptRowHeight(row, wrapWidth))
  const contentHeight = heights.reduce((sum, height) => sum + height, 0)
  const limit = Math.max(0, viewportHeight)
  const taller = contentHeight > limit
  const maxStart = maxTranscriptStart(contentHeight, limit)
  const pinned = scroll.pinned || !taller
  const startLine = pinned ? maxStart : Math.min(maxStart, Math.max(0, scroll.startLine))
  const empty = {
    rows: rows.length === 0 ? rows : [] as TranscriptRow[],
    taller: rows.length === 0 ? false : taller,
    contentHeight,
    skipLeadingLines: 0,
    skipTrailingLines: 0,
    visibleHeight: 0,
    startLine,
    pinned,
  }
  if (rows.length === 0) {
    return { rows, taller: false, contentHeight: 0, skipLeadingLines: 0, skipTrailingLines: 0, visibleHeight: 0, startLine: 0, pinned: true }
  }
  if (limit <= 0) return empty
  const endLine = Math.min(contentHeight, startLine + limit)
  let acc = 0
  let first = -1
  let last = -1
  let skipLeadingLines = 0
  let skipTrailingLines = 0
  for (let index = 0; index < rows.length; index += 1) {
    const height = heights[index] ?? 1
    const rowStart = acc
    const rowEnd = acc + height
    acc = rowEnd
    if (rowEnd <= startLine || rowStart >= endLine) continue
    if (first < 0) {
      first = index
      skipLeadingLines = Math.max(0, startLine - rowStart)
    }
    last = index
    skipTrailingLines = Math.max(0, rowEnd - endLine)
  }
  if (first < 0 || last < 0) return empty
  return {
    rows: rows.slice(first, last + 1),
    taller,
    contentHeight,
    skipLeadingLines,
    skipTrailingLines,
    visibleHeight: endLine - startLine,
    startLine,
    pinned,
  }
}
