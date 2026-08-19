/**
 * Double-Escape rewind arm. First Esc starts a short window and, when the
 * editor is idle and empty, shows `esc again to edit last`. A second Esc
 * inside the window — or while that notice is still up — restores the last
 * submitted prompt locally. DSH has no rewind / undo-last-turn API, so
 * session history is left intact.
 * @module @deepseek-ai/dsh-tui/rewind
 */

/** Claude Code-like double-Esc window, in milliseconds. Wide enough for a pause. */
export const REWIND_ARM_MS = 2000

/** Status hint shown after the first idle+empty Esc. */
export const REWIND_HINT = 'esc again to edit last'

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

/**
 * Whether a second Esc should restore. The time window or the still-showing
 * hint are enough — ComputerUse and hesitant humans both miss 800ms.
 * @param armedAt - epoch ms when the first Esc landed, if any.
 * @param now - current epoch ms.
 * @param noticeText - current status notice text, if any.
 * @param windowMs - arm length.
 * @returns true when a second Esc should restore the last prompt.
 */
export function rewindReady(
  armedAt: number | undefined,
  now: number,
  noticeText: string | undefined,
  windowMs = REWIND_ARM_MS,
): boolean {
  if (noticeText === REWIND_HINT) return true
  return rewindArmed(armedAt, now, windowMs)
}
