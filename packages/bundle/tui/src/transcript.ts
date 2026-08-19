/**
 * Pure projection of a DSH session log into Claude Code-like transcript items:
 * user bubbles, streaming assistant text, foldable reasoning, and tool cards.
 * @module @deepseek-ai/dsh-tui/transcript
 */

import type { ContentBlock, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tool-workflow'

/** Tool-card lifecycle. */
export type ToolCardStatus = 'running' | 'success' | 'error' | 'awaiting'

/** One renderable row in the chat transcript. */
export type TranscriptItem =
  | {
    readonly kind: 'user'
    readonly id: string
    readonly seq: number
    readonly text: string
  }
  | {
    readonly kind: 'assistant'
    readonly id: string
    readonly seq: number
    readonly text: string
    readonly streaming: boolean
  }
  | {
    readonly kind: 'reasoning'
    readonly id: string
    readonly seq: number
    readonly text: string
    readonly streaming: boolean
    readonly expanded: boolean
  }
  | {
    readonly kind: 'tool'
    readonly id: string
    readonly seq: number
    readonly callId: string
    readonly name: string
    readonly args: string
    readonly result?: string
    readonly status: ToolCardStatus
    readonly expanded: boolean
    readonly meta?: unknown
  }
  | {
    readonly kind: 'command'
    readonly id: string
    readonly seq: number
    readonly text: string
  }
  | {
    readonly kind: 'workflow'
    readonly id: string
    readonly seq: number
    readonly runId: string
    readonly name: string
    readonly status: 'running' | 'success' | 'error'
    readonly members: readonly WorkflowMember[]
    readonly expanded: boolean
  }

/** One workflow member projected from tool-workflow agent events. */
export interface WorkflowMember {
  readonly seq: number
  readonly label: string
  readonly phase?: string
  readonly status: 'running' | 'success' | 'error'
}

/** Expansion sets owned by the TUI, keyed by item id. */
export interface TranscriptExpansion {
  readonly tools: ReadonlySet<string>
  readonly reasoning: ReadonlySet<string>
  readonly workflows: ReadonlySet<string>
}

/**
 * Concatenate text blocks from a message content array.
 * @param content - message content blocks.
 * @returns joined text, ignoring non-text blocks.
 */
export function textOf(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/**
 * Latest log-backed session title, if any.
 * @param events - session events in log order.
 * @returns the last `session/title` text.
 */
export function foldSessionTitle(events: readonly SessionEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'session/title') return event.data.title
  }
  return undefined
}

/**
 * Latest request-header model route, if any.
 * @param events - session events in log order.
 * @returns provider and model from the last `request/header`.
 */
export function foldRequestModel(events: readonly SessionEvent[]): { provider: string; model: string } | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'request/header') {
      return { provider: event.data.header.config.provider, model: event.data.header.config.model }
    }
  }
  return undefined
}

/** Apply one stream chunk onto an in-progress assistant/reasoning buffer. */
function applyChunk(
  buffers: Map<number, { text: string; reasoning: string }>,
  chunk: StreamChunk,
): Map<number, { text: string; reasoning: string }> {
  const next = new Map(buffers)
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' || chunk.type === 'block-start') {
    const current = next.get(chunk.index) ?? { text: '', reasoning: '' }
    if (chunk.type === 'text-delta') next.set(chunk.index, { ...current, text: current.text + chunk.text })
    else if (chunk.type === 'reasoning-delta') next.set(chunk.index, { ...current, reasoning: current.reasoning + chunk.text })
    else next.set(chunk.index, current)
  }
  return next
}

/**
 * Project a DSH session log into Claude Code-like chat rows. Streaming chunks are
 * folded until the matching `assistant/message` lands. Human `user/message`
 * rows keep append-origin text; plugin/tool sources are omitted.
 * @param events - session events in log order.
 * @param expansion - which tool/reasoning cards the user has expanded.
 * @returns ordered transcript items.
 */
export function projectTranscript(
  events: readonly SessionEvent[],
  expansion: TranscriptExpansion = { tools: new Set(), reasoning: new Set(), workflows: new Set() },
): TranscriptItem[] {
  const items: TranscriptItem[] = []
  let chunkBuffers = new Map<number, { text: string; reasoning: string }>()
  const openTools = new Map<string, TranscriptItem & { kind: 'tool' }>()
  const openWorkflows = new Map<string, TranscriptItem & { kind: 'workflow' }>()
  let streamingTurn: { turn: number; step: number } | undefined

  for (const event of events) {
    switch (event.type) {
      case 'user/message': {
        if (event.data.source.kind !== 'user') break
        const text = textOf(event.data.content).trim()
        if (text === '') break
        items.push({ kind: 'user', id: `user:${event.seq}`, seq: event.seq, text })
        break
      }
      case 'assistant/chunk': {
        streamingTurn = { turn: event.data.turn, step: event.data.step }
        chunkBuffers = applyChunk(chunkBuffers, event.data.chunk)
        break
      }
      case 'assistant/message': {
        streamingTurn = undefined
        chunkBuffers = new Map()
        for (const block of event.data.message.content) {
          if (block.type === 'reasoning' && block.text.trim() !== '') {
            const id = `reason:${event.seq}`
            items.push({
              kind: 'reasoning',
              id,
              seq: event.seq,
              text: block.text,
              streaming: false,
              expanded: expansion.reasoning.has(id),
            })
          }
          if (block.type === 'text' && block.text.trim() !== '') {
            items.push({
              kind: 'assistant',
              id: `asst:${event.seq}`,
              seq: event.seq,
              text: block.text,
              streaming: false,
            })
          }
        }
        break
      }
      case 'tool/call': {
        const id = `tool:${event.data.callId}`
        const card: TranscriptItem & { kind: 'tool' } = {
          kind: 'tool',
          id,
          seq: event.seq,
          callId: event.data.callId,
          name: event.data.name,
          args: event.data.arguments,
          status: 'running',
          expanded: expansion.tools.has(id),
        }
        openTools.set(event.data.callId, card)
        items.push(card)
        break
      }
      case 'tool/result': {
        const callId = event.data.message.source.kind === 'tool' ? event.data.message.source.callId : undefined
        if (callId === undefined) break
        const id = `tool:${callId}`
        const prior = openTools.get(callId)
        const result = textOf(event.data.message.content)
        const status: ToolCardStatus = event.data.message.content.some(block => block.type === 'tool-result' && block.isError === true)
          || event.data.error !== undefined
          ? 'error'
          : 'success'
        const card: TranscriptItem & { kind: 'tool' } = {
          kind: 'tool',
          id,
          seq: prior?.seq ?? event.seq,
          callId,
          name: prior?.name ?? 'tool',
          args: prior?.args ?? '',
          result,
          status,
          expanded: expansion.tools.has(id),
          meta: event.data.meta,
        }
        if (prior !== undefined) {
          const index = items.lastIndexOf(prior)
          if (index >= 0) items[index] = card
        } else {
          items.push(card)
        }
        openTools.set(callId, card)
        break
      }
      case 'tool-workflow/run-start': {
        const id = `workflow:${event.data.runId}`
        const card: TranscriptItem & { kind: 'workflow' } = {
          kind: 'workflow',
          id,
          seq: event.seq,
          runId: event.data.runId,
          name: event.data.name,
          status: 'running',
          members: [],
          expanded: expansion.workflows.has(id),
        }
        openWorkflows.set(event.data.runId, card)
        items.push(card)
        break
      }
      case 'tool-workflow/agent-start': {
        const prior = openWorkflows.get(event.data.runId)
        if (prior === undefined) break
        const card: TranscriptItem & { kind: 'workflow' } = {
          ...prior,
          members: [...prior.members, {
            seq: event.data.seq,
            label: event.data.label,
            ...(event.data.phase === undefined ? {} : { phase: event.data.phase }),
            status: 'running',
          }],
          expanded: expansion.workflows.has(prior.id),
        }
        replaceItem(items, prior, card)
        openWorkflows.set(event.data.runId, card)
        break
      }
      case 'tool-workflow/agent-end': {
        const prior = openWorkflows.get(event.data.runId)
        if (prior === undefined) break
        const memberStatus = event.data.outcome === 'completed' ? 'success' : 'error'
        const card: TranscriptItem & { kind: 'workflow' } = {
          ...prior,
          members: prior.members.map(member => member.seq === event.data.seq
            ? { ...member, status: memberStatus }
            : member),
          expanded: expansion.workflows.has(prior.id),
        }
        replaceItem(items, prior, card)
        openWorkflows.set(event.data.runId, card)
        break
      }
      case 'tool-workflow/run-end': {
        const prior = openWorkflows.get(event.data.runId)
        if (prior === undefined) break
        const card: TranscriptItem & { kind: 'workflow' } = {
          ...prior,
          status: event.data.stopReason === 'completed' ? 'success' : 'error',
          expanded: expansion.workflows.has(prior.id),
        }
        replaceItem(items, prior, card)
        openWorkflows.set(event.data.runId, card)
        break
      }
      case 'command/done': {
        const text = event.data.text
        if (typeof text === 'string' && text.trim() !== '') {
          items.push({ kind: 'command', id: `cmd:${event.seq}`, seq: event.seq, text })
        }
        break
      }
      default:
        break
    }
  }

  if (streamingTurn !== undefined && chunkBuffers.size > 0) {
    let reasoning = ''
    let text = ''
    for (const buffer of chunkBuffers.values()) {
      reasoning += buffer.reasoning
      text += buffer.text
    }
    if (reasoning !== '') {
      const id = `reason:stream:${streamingTurn.turn}:${streamingTurn.step}`
      items.push({
        kind: 'reasoning',
        id,
        seq: Number.MAX_SAFE_INTEGER - 1,
        text: reasoning,
        streaming: true,
        expanded: expansion.reasoning.has(id),
      })
    }
    if (text !== '') {
      items.push({
        kind: 'assistant',
        id: `asst:stream:${streamingTurn.turn}:${streamingTurn.step}`,
        seq: Number.MAX_SAFE_INTEGER,
        text,
        streaming: true,
      })
    }
  }
  return items
}

/** Replace a projected card in place when a later event updates it. */
function replaceItem(
  items: TranscriptItem[],
  prior: TranscriptItem,
  next: TranscriptItem,
): void {
  const index = items.lastIndexOf(prior)
  if (index >= 0) items[index] = next
}

/**
 * Toggle one expansion id in an immutable set.
 * @param current - current expansion ids.
 * @param id - item id to toggle.
 * @returns a new set with the id added or removed.
 */
export function toggleId(current: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(current)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}
