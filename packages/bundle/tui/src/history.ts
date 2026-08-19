/**
 * Session prompt history: Up/Down recall and Ctrl+R reverse search.
 * Pure so unit tests do not need Ink.
 * @module @deepseek-ai/dsh-tui/history
 */

/** Snapshot of the in-progress editor while browsing history. */
export interface HistoryBrowse {
  readonly history: readonly string[]
  readonly historyIndex?: number
  readonly historyDraft?: string
  readonly historyQuery?: string
}

/** Result of one recall / search step. */
export interface HistoryRecall {
  readonly input: string
  readonly cursor: number
  readonly historyIndex?: number
  readonly historyDraft?: string
  readonly historyQuery?: string
}

/**
 * Whether the caret is on the first visual line (so Up may recall history).
 * @param input - editor contents.
 * @param cursor - caret index.
 * @returns true when no newline sits before the caret.
 */
export function isOnFirstLine(input: string, cursor: number): boolean {
  const at = cursor < 0 ? 0 : cursor > input.length ? input.length : cursor
  return !input.slice(0, at).includes('\n')
}

/**
 * Whether the caret is on the last visual line (so Down may restore draft).
 * @param input - editor contents.
 * @param cursor - caret index.
 * @returns true when no newline sits after the caret.
 */
export function isOnLastLine(input: string, cursor: number): boolean {
  const at = cursor < 0 ? 0 : cursor > input.length ? input.length : cursor
  return !input.slice(at).includes('\n')
}

/**
 * Append a submitted prompt. Skips empty text and an immediate duplicate.
 * @param history - current session history (oldest first).
 * @param text - submitted prompt.
 * @returns the next history list.
 */
export function pushHistory(history: readonly string[], text: string): readonly string[] {
  const trimmed = text.replace(/\s+$/u, '')
  if (trimmed.trim() === '') return history
  if (history[history.length - 1] === trimmed) return history
  return [...history, trimmed]
}

/**
 * Newest-first filter for the Ctrl+R overlay.
 * @param history - oldest-first session history.
 * @param query - substring filter (case-insensitive).
 * @returns matching prompts, newest first.
 */
export function filterHistory(history: readonly string[], query: string): string[] {
  const needle = query.trim().toLowerCase()
  const newest = [...history].reverse()
  if (needle === '') return newest
  return newest.filter(item => item.toLowerCase().includes(needle))
}

/**
 * Walk one step through history. `delta` of -1 is older; +1 is newer / draft.
 * @param browse - current history + browse cursor.
 * @param currentInput - editor text when not already browsing.
 * @param delta - -1 older, +1 newer.
 * @returns the recalled buffer, or undefined when history is empty.
 */
export function recallHistory(
  browse: HistoryBrowse,
  currentInput: string,
  delta: number,
): HistoryRecall | undefined {
  if (browse.history.length === 0) return undefined
  const browsing = browse.historyIndex !== undefined
  const draft = browsing ? (browse.historyDraft ?? '') : currentInput
  const current = browsing ? browse.historyIndex : browse.history.length
  const next = current + delta
  if (next < 0) {
    const text = browse.history[0]
    if (text === undefined) return undefined
    return {
      input: text,
      cursor: text.length,
      historyIndex: 0,
      historyDraft: draft,
    }
  }
  if (next >= browse.history.length) {
    return { input: draft, cursor: draft.length }
  }
  const text = browse.history[next]
  if (text === undefined) return undefined
  return {
    input: text,
    cursor: text.length,
    historyIndex: next,
    historyDraft: draft,
  }
}

/**
 * Ctrl+R: find the next older entry that contains `query` (case-insensitive).
 * An empty query walks every entry, newest first.
 * @param browse - current history + browse cursor.
 * @param currentInput - editor text when starting a search.
 * @returns the matched buffer, or undefined when nothing matches.
 */
export function reverseSearchHistory(
  browse: HistoryBrowse,
  currentInput: string,
): HistoryRecall | undefined {
  if (browse.history.length === 0) return undefined
  const browsing = browse.historyIndex !== undefined
  const draft = browsing ? (browse.historyDraft ?? '') : currentInput
  const query = browse.historyQuery ?? (browsing ? (browse.historyQuery ?? draft) : currentInput)
  const needle = query.trim().toLowerCase()
  const start = browsing ? browse.historyIndex - 1 : browse.history.length - 1
  for (let index = start; index >= 0; index -= 1) {
    const text = browse.history[index]
    if (text === undefined) continue
    if (needle === '' || text.toLowerCase().includes(needle)) {
      return {
        input: text,
        cursor: text.length,
        historyIndex: index,
        historyDraft: draft,
        historyQuery: query,
      }
    }
  }
  return undefined
}
