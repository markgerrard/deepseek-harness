/**
 * Readline-style prompt edits and cursor paint split. Pure so unit tests do
 * not need Ink.
 * @module @deepseek-ai/dsh-tui/prompt
 */

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

/** CSI hide — Ink may restore the hardware caret after a paint. */
export const CSI_HIDE_CURSOR = '\x1b[?25l'
/** CSI show — restore the hardware caret on unmount. */
export const CSI_SHOW_CURSOR = '\x1b[?25h'

/**
 * Hide or show the terminal hardware caret. Only our block caret should show
 * while the TUI is mounted.
 * @param stdout - stream that accepts CSI writes.
 * @param visible - `false` hides, `true` shows.
 */
export function setHardwareCursorVisible(
  stdout: { write(chunk: string): unknown },
  visible: boolean,
): void {
  stdout.write(visible ? CSI_SHOW_CURSOR : CSI_HIDE_CURSOR)
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
 * Prompt paint parts: input split at `cursor` with the character under the
 * caret as the cursor segment (empty at end-of-input). That character is
 * omitted from `after` so it is not drawn twice. Extra paint cell, never
 * inserted into the buffer.
 * @param input - editor contents.
 * @param cursor - caret index.
 * @returns segments to render left-to-right.
 */
export function promptPaint(input: string, cursor: number): PromptPaint {
  const at = clampCursor(cursor, input.length)
  return {
    before: input.slice(0, at),
    cursor: input.slice(at, at + 1),
    after: input.slice(at + 1),
  }
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
 * End index of the whitespace-delimited word after `cursor`.
 * @param input - editor contents.
 * @param cursor - caret index.
 * @returns the word end, or `input.length`.
 */
function nextWordEnd(input: string, cursor: number): number {
  let i = clampCursor(cursor, input.length)
  while (i < input.length && /\s/.test(input.charAt(i))) i += 1
  while (i < input.length && !/\s/.test(input.charAt(i))) i += 1
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
    case 'alt+left':
    case 'ctrl+left':
    case 'alt+b':
      return { input, cursor: previousWordStart(input, at) }
    case 'alt+right':
    case 'ctrl+right':
    case 'alt+f':
      return { input, cursor: nextWordEnd(input, at) }
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
