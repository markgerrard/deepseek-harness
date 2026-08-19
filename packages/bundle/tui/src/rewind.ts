/**
 * Double-Escape rewind arm. First Esc starts a short window; a second Esc
 * inside it restores the last submitted prompt locally. DSH has no rewind /
 * undo-last-turn API, so session history is left intact.
 * @module @deepseek-ai/dsh-tui/rewind
 */

/** Claude Code-like double-Esc window, in milliseconds. */
export const REWIND_ARM_MS = 800

/**
 * Whether `now` falls inside an armed rewind window.
 * @param armedAt - epoch ms when the first Esc landed, if any.
 * @param now - current epoch ms.
 * @param windowMs - arm length.
 * @returns true when a second Esc should restore the last prompt.
 */
export function rewindArmed(armedAt: number | undefined, now: number, windowMs = REWIND_ARM_MS): boolean {
  if (armedAt === undefined) return false
  return now - armedAt <= windowMs && now >= armedAt
}
