/**
 * Follow-up prompt suggestion: a ghost placeholder after an idle chat turn.
 * Generation is a detached one-shot LLM call, never a transcript card.
 * @module @deepseek-ai/dsh-tui/suggestion
 */

import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { TranscriptItem } from './transcript.ts'

/** Maximum whitespace-delimited words kept in a suggestion. */
export const MAX_SUGGESTION_WORDS = 10

/** Words kept when synthesizing a follow-up from the last assistant. */
export const FALLBACK_SUGGESTION_WORDS = 8

/** Detached suggestion stream is aborted after this many ms so a hang cannot block the ghost. */
export const SUGGESTION_TIMEOUT_MS = 8000

/** Empty-editor placeholder used on landing and when no suggestion is ready. */
export const ASK_PLACEHOLDER = 'Ask DSH…'

/** System instruction for the detached follow-up completion. */
export const SUGGESTION_SYSTEM = [
  'Reply with ONLY the next user prompt the user might type.',
  'Use a short imperative, user-style follow-up. Not a sentence about the model.',
  `Maximum ${MAX_SUGGESTION_WORDS} words. No quotes, no preamble, no markdown.`,
].join(' ')

/**
 * Normalize model output into a short ghost suggestion.
 * Takes the first line, strips wrapping quotes, and trims to
 * {@link MAX_SUGGESTION_WORDS}. Empty or whitespace-only text is rejected.
 * @param text - raw model output.
 * @returns a capped suggestion, or `undefined` when nothing usable remains.
 */
export function capSuggestion(text: string): string | undefined {
  let cleaned = text.trim()
  const newline = cleaned.search(/\r?\n/)
  if (newline !== -1) cleaned = cleaned.slice(0, newline).trim()
  const quote = cleaned[0]
  if ((quote === '"' || quote === "'") && cleaned.length >= 2 && cleaned.endsWith(quote)) {
    cleaned = cleaned.slice(1, -1).trim()
  }
  if (cleaned === '') return undefined
  const words = cleaned.split(/\s+/).filter(word => word.length > 0)
  if (words.length === 0) return undefined
  if (words.length > MAX_SUGGESTION_WORDS) return words.slice(0, MAX_SUGGESTION_WORDS).join(' ')
  return cleaned
}

/**
 * Ghost placeholder shown when the editor is empty.
 * A suggestion replaces {@link ASK_PLACEHOLDER} only when one is set.
 * @param state - editor text and optional suggestion.
 * @returns the muted placeholder string.
 */
export function promptPlaceholder(state: { readonly input: string; readonly suggestion?: string }): string {
  if (state.input !== '') return ASK_PLACEHOLDER
  if (state.suggestion !== undefined && state.suggestion !== '') return state.suggestion
  return ASK_PLACEHOLDER
}

/**
 * Whether a finished suggestion request may still be committed.
 * @param state - current editor/busy facts.
 * @param requestEpoch - epoch captured when the request started.
 * @param currentEpoch - latest epoch (bumped on type, submit, or a new turn).
 * @returns true when the editor is still empty, idle, and the request is current.
 */
export function shouldApplySuggestion(
  state: { readonly input: string; readonly busy: boolean },
  requestEpoch: number,
  currentEpoch: number,
): boolean {
  return requestEpoch === currentEpoch && state.input === '' && !state.busy
}

/**
 * Format the last user and last assistant cards as compact model-visible context.
 * Earlier turns, tools, and reasoning are omitted.
 * @param items - projected transcript rows.
 * @param maxChars - per-card character cap.
 * @returns a snippet, or empty when either role is missing.
 */
export function conversationSnippet(
  items: readonly TranscriptItem[],
  maxChars = 400,
): string {
  let lastUser: string | undefined
  let lastAssistant: string | undefined
  for (const item of items) {
    if (item.kind === 'user') lastUser = item.text
    else if (item.kind === 'assistant') lastAssistant = item.text
  }
  if (lastUser === undefined || lastAssistant === undefined) return ''
  const clip = (value: string): string => (value.length > maxChars ? `${value.slice(0, maxChars)}…` : value)
  return `User: ${clip(lastUser)}\nAssistant: ${clip(lastAssistant)}`
}

/**
 * Last-assistant fallback used only when a detached LLM suggestion fails.
 * Takes the first {@link FALLBACK_SUGGESTION_WORDS} words as a short phrase.
 * @param items - projected transcript rows.
 * @returns a capped phrase, or `undefined` when no assistant text exists.
 */
export function fallbackSuggestion(items: readonly TranscriptItem[]): string | undefined {
  let lastAssistant: string | undefined
  for (const item of items) {
    if (item.kind === 'assistant') lastAssistant = item.text
  }
  if (lastAssistant === undefined) return undefined
  const words = lastAssistant.trim().split(/\s+/).filter(word => word.length > 0)
    .slice(0, FALLBACK_SUGGESTION_WORDS)
  return capSuggestion(words.join(' '))
}

/**
 * User-message body for the detached suggestion call.
 * @param snippet - {@link conversationSnippet} output.
 * @returns the framed prompt.
 */
export function suggestionUserPrompt(snippet: string): string {
  return `Recent conversation:\n${snippet}\n\nSuggest the next user follow-up.`
}

/**
 * Build a hand-built one-shot request that is not an agent-loop turn.
 * Omitting `sessionId` and `purpose` keeps it off the session log and title path.
 * @param route - currently selected provider/model.
 * @param snippet - conversation context.
 * @param signal - cancellation for stale requests.
 * @returns generate options for `ctx.llm.stream`.
 */
export function suggestionGenerateOptions(
  route: { readonly provider: string; readonly model: string },
  snippet: string,
  signal: AbortSignal,
): GenerateOptions {
  return {
    provider: route.provider,
    model: route.model,
    system: SUGGESTION_SYSTEM,
    messages: [createUserMessage({
      content: [{ type: 'text', text: suggestionUserPrompt(snippet) }],
      source: { kind: 'plugin', plugin: 'dsh-tui' },
    })],
    maxTokens: 40,
    signal,
  }
}

/**
 * Assemble visible text from a detached stream. Does not touch the session log.
 * @param stream - `ctx.llm.stream` iterable.
 * @returns concatenated text blocks.
 */
export async function readSuggestionText(stream: AsyncIterable<StreamChunk>): Promise<string> {
  const assembler = new BlockAssembler()
  for await (const chunk of stream) assembler.push(chunk)
  const finish = assembler.finish
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    throw new Error(finish.failure.message)
  }
  const blocks = assembler.blocks()
  return blocks
    .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join(' ')
}
