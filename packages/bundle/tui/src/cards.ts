/**
 * Crush-style chat bubbles and tool cards. Diff meta from DSH tool results
 * is rendered when present; otherwise the card stays a collapsed header.
 * @module @deepseek-ai/dsh-tui/cards
 */

import type { TranscriptItem } from './transcript.ts'
import { ICONS } from './theme.ts'
import { truncate } from './status.ts'

/** One rendered transcript block ready for Ink. */
export interface RenderedCard {
  readonly id: string
  readonly kind: TranscriptItem['kind']
  readonly text: string
}

/**
 * Summarize a JSON-ish tool-args string for the collapsed Crush card header.
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
    return record.diff.split('\n').map(line => truncate(line, width)).join('\n')
  }
  const oldText = typeof record.oldText === 'string' ? record.oldText : undefined
  const newText = typeof record.newText === 'string' ? record.newText : undefined
  if (oldText === undefined && newText === undefined) return undefined
  const before = (oldText ?? '').split('\n')
  const after = (newText ?? '').split('\n')
  const lines: string[] = []
  const max = Math.max(before.length, after.length)
  for (let index = 0; index < max && lines.length < 16; index += 1) {
    const left = before[index]
    const right = after[index]
    if (left === right) continue
    if (left !== undefined) lines.push(truncate(`- ${left}`, width))
    if (right !== undefined) lines.push(truncate(`+ ${right}`, width))
  }
  return lines.length === 0 ? undefined : lines.join('\n')
}

/**
 * Render one Crush transcript item.
 * @param item - projected transcript row.
 * @param width - chat columns.
 * @returns a titled card or bubble.
 */
export function renderCard(item: TranscriptItem, width: number): RenderedCard {
  const inner = Math.max(8, width - 2)
  switch (item.kind) {
    case 'user':
      return {
        id: item.id,
        kind: item.kind,
        text: [`${ICONS.borderThick} you`, ...item.text.split('\n').map(line => `${ICONS.borderThin} ${truncate(line, inner)}`)].join('\n'),
      }
    case 'assistant': {
      const suffix = item.streaming ? ` ${ICONS.spinner}` : ''
      return {
        id: item.id,
        kind: item.kind,
        text: item.text.split('\n').map(line => truncate(line, inner)).join('\n') + suffix,
      }
    }
    case 'reasoning': {
      const label = item.expanded ? 'thinking' : 'thinking (space to expand)'
      const head = `${ICONS.spinner} ${label}`
      if (!item.expanded) return { id: item.id, kind: item.kind, text: truncate(head, inner) }
      const body = item.text.split('\n').slice(0, 12).map(line => truncate(line, inner))
      return { id: item.id, kind: item.kind, text: [head, ...body].join('\n') }
    }
    case 'tool': {
      const mark = item.status === 'success' ? ICONS.toolSuccess
        : item.status === 'error' ? ICONS.toolError
          : item.status === 'awaiting' ? ICONS.radioOn
            : ICONS.toolPending
      const summary = summarizeArgs(item.args, Math.max(8, inner - item.name.length - 6))
      const head = summary === '' ? `${mark} ${item.name}` : `${mark} ${item.name}  ${summary}`
      if (!item.expanded) return { id: item.id, kind: item.kind, text: truncate(head, inner) }
      const diff = renderDiff(item.meta, inner)
      const result = item.result === undefined ? [] : item.result.split('\n').slice(0, 12).map(line => truncate(line, inner))
      const extra = diff === undefined ? result : [diff, ...result]
      return { id: item.id, kind: item.kind, text: [truncate(head, inner), ...extra].join('\n') }
    }
    case 'command':
      return { id: item.id, kind: item.kind, text: truncate(`${ICONS.check} ${item.text}`, inner) }
    default: {
      const _exhaustive: never = item
      return _exhaustive
    }
  }
}

/**
 * Render a transcript for the Crush chat pane.
 * @param items - projected rows.
 * @param width - chat columns.
 * @returns joined card text.
 */
export function renderTranscript(items: readonly TranscriptItem[], width: number): string {
  if (items.length === 0) return ''
  return items.map(item => renderCard(item, width).text).join('\n\n')
}
