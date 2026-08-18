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

/** One rendered transcript block ready for Ink. */
export interface RenderedCard {
  readonly id: string
  readonly kind: TranscriptItem['kind']
  readonly text: string
  readonly segments: readonly CardSegment[]
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
 * @param item - projected transcript row.
 * @param width - chat columns.
 * @returns a titled card or bubble.
 */
function card(id: string, kind: TranscriptItem['kind'], segments: readonly CardSegment[]): RenderedCard {
  return { id, kind, text: segments.map(segment => segment.text).join(''), segments }
}

export function renderCard(item: TranscriptItem, width: number): RenderedCard {
  const inner = Math.max(8, width)
  switch (item.kind) {
    case 'user':
      return card(item.id, item.kind, [
        { text: `${ICONS.user} `, tone: 'user' },
        { text: wrapText(item.text, Math.max(1, inner - 2)), tone: 'fg' },
      ])
    case 'assistant': {
      const body = wrapText(item.text, Math.max(1, inner - 2))
      const segments: CardSegment[] = [
        { text: `${ICONS.assistant} `, tone: 'assistant' },
        { text: body, tone: 'assistant' },
      ]
      if (item.streaming) segments.push({ text: ` ${ICONS.spinner}`, tone: 'brand' })
      return card(item.id, item.kind, segments)
    }
    case 'reasoning': {
      const label = item.expanded ? 'thinking' : 'thinking (space to expand)'
      const segments: CardSegment[] = [
        { text: `${ICONS.spinner} `, tone: 'brand' },
        { text: wrapText(label, Math.max(1, inner - 2)), tone: 'thinking' },
      ]
      if (item.expanded) segments.push({ text: `\n${wrapText(item.text, inner)}`, tone: 'thinking' })
      return card(item.id, item.kind, segments)
    }
    case 'tool': {
      const mark = item.status === 'success' ? ICONS.toolSuccess
        : item.status === 'error' ? ICONS.toolError
          : item.status === 'awaiting' ? ICONS.selector
            : ICONS.toolPending
      const title = formatToolTitle(item.name)
      const summary = summarizeArgs(item.args, Math.max(8, inner - title.length - 4))
      const segments: CardSegment[] = [
        { text: `${mark} `, tone: toolMarkTone(item.status) },
        { text: title, tone: 'tool' },
      ]
      if (summary !== '') segments.push({ text: `\n  ${summary}`, tone: 'muted' })
      if (item.expanded) {
        const diff = renderDiff(item.meta, inner)
        const result = item.result ?? ''
        const extra = [diff, result].filter((part): part is string => part !== undefined && part !== '')
        if (extra.length > 0) segments.push({ text: `\n${extra.join('\n')}`, tone: 'muted' })
      }
      return card(item.id, item.kind, segments)
    }
    case 'command':
      return card(item.id, item.kind, [
        { text: `${ICONS.check} `, tone: 'success' },
        { text: wrapText(item.text, Math.max(1, inner - 2)), tone: 'fg' },
      ])
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
