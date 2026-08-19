/**
 * Readline-style prompt edits and cursor paint split. Pure so unit tests do
 * not need Ink.
 * @module @deepseek-ai/dsh-tui/prompt
 */

import { ICONS } from './theme.ts'

/** Result of one prompt-buffer edit. */
export interface PromptEdit {
  readonly input: string
  readonly cursor: number
  readonly kill?: string
}

/** Before / cursor-glyph / after segments for painting `state.cursor`. */
export interface PromptPaint {
  readonly before: string
  readonly cursor: string
  readonly after: string
}

/**
 * Clamp `cursor` into `[0, length]`.
 * @param cursor - requested index.
 * @param length - buffer length.
 * @returns a safe index.
 */
export function clampCursor(cursor: number, length: number): number {
  if (cursor < 0) return 0
  if (cursor > length) return length
  return cursor
}

/**
 * Split the prompt buffer at `cursor` so the paint can place a glyph there.
 * @param input - editor contents.
 * @param cursor - caret index.
 * @returns text before and after the caret.
 */
export function splitAtCursor(input: string, cursor: number): { before: string; after: string } {
  const at = clampCursor(cursor, input.length)
  return { before: input.slice(0, at), after: input.slice(at) }
}

/**
 * Prompt paint parts: input split at `cursor` with the block glyph in between.
 * @param input - editor contents.
 * @param cursor - caret index.
 * @returns segments to render left-to-right.
 */
export function promptPaint(input: string, cursor: number): PromptPaint {
  const { before, after } = splitAtCursor(input, cursor)
  return { before, cursor: ICONS.cursor, after }
}

/**
 * Insert `text` at `cursor`.
 * @param input - editor contents.
 * @param cursor - caret index.
 * @param text - characters to insert.
 * @returns the edited buffer.
 */
export function insertAtCursor(input: string, cursor: number, text: string): PromptEdit {
  const at = clampCursor(cursor, input.length)
  return { input: `${input.slice(0, at)}${text}${input.slice(at)}`, cursor: at + text.length }
}

/**
 * Start index of the whitespace-delimited word before `cursor`.
 * @param input - editor contents.
 * @param cursor - caret index.
 * @returns the word start, or 0.
 */
function previousWordStart(input: string, cursor: number): number {
  let i = clampCursor(cursor, input.length)
  while (i > 0 && /\s/.test(input.charAt(i - 1))) i -= 1
  while (i > 0 && !/\s/.test(input.charAt(i - 1))) i -= 1
  return i
}

/**
 * Apply one readline-style (or insert/backspace) key to the prompt buffer.
 * Reserved chrome keys (`ctrl+c`, `ctrl+n`, `ctrl+l`, `ctrl+p`, `ctrl+s`,
 * `ctrl+g`, `ctrl+t`) are not handled here.
 * @param input - editor contents.
 * @param cursor - caret index.
 * @param key - Ink key name (`ctrl+a`, `backspace`, …).
 * @param kill - last killed text, used by yank.
 * @returns the edit, or `undefined` when `key` is not a prompt binding.
 */
export function applyPromptKey(
  input: string,
  cursor: number,
  key: string,
  kill?: string,
): PromptEdit | undefined {
  const at = clampCursor(cursor, input.length)
  switch (key) {
    case 'ctrl+a':
      return { input, cursor: 0 }
    case 'ctrl+e':
      return { input, cursor: input.length }
    case 'ctrl+b':
    case 'left':
      return { input, cursor: Math.max(0, at - 1) }
    case 'ctrl+f':
    case 'right':
      return { input, cursor: Math.min(input.length, at + 1) }
    case 'ctrl+k': {
      if (at >= input.length) return { input, cursor: at }
      return { input: input.slice(0, at), cursor: at, kill: input.slice(at) }
    }
    case 'ctrl+u': {
      if (at === 0) return { input, cursor: 0 }
      return { input: input.slice(at), cursor: 0, kill: input.slice(0, at) }
    }
    case 'ctrl+w': {
      const start = previousWordStart(input, at)
      if (start === at) return { input, cursor: at }
      return { input: `${input.slice(0, start)}${input.slice(at)}`, cursor: start, kill: input.slice(start, at) }
    }
    case 'ctrl+y': {
      if (kill === undefined || kill === '') return { input, cursor: at }
      return insertAtCursor(input, at, kill)
    }
    case 'ctrl+d':
    case 'delete': {
      if (at >= input.length) return { input, cursor: at }
      return { input: `${input.slice(0, at)}${input.slice(at + 1)}`, cursor: at }
    }
    case 'ctrl+h':
    case 'backspace': {
      if (at === 0) return { input, cursor: 0 }
      return { input: `${input.slice(0, at - 1)}${input.slice(at)}`, cursor: at - 1 }
    }
    case 'ctrl+j':
      return insertAtCursor(input, at, '\n')
    default:
      return undefined
  }
}
