/**
 * Crush chrome render helpers: diagonal header, logo, sidebar, landing,
 * onboarding, and overlay frames. Return plain strings for Ink `Text`.
 * @module @deepseek-ai/dsh-tui/chrome
 */

import { formatHelpLine, formatModelLine, prettyPath, truncate, type StatusModel } from './status.ts'
import { ICONS, PRODUCT_MARK, PRODUCT_NAME } from './theme.ts'
import type { SessionRow } from './state.ts'

/**
 * Crush header: diagonal ╱ pattern, product mark, and occupancy.
 * @param width - header columns.
 * @param status - model/cwd/token facts.
 * @param compact - whether to use the one-line compact logo.
 * @returns header lines joined by newline.
 */
export function renderHeader(width: number, status: StatusModel, compact: boolean): string {
  const mark = `${PRODUCT_MARK} ${PRODUCT_NAME}`
  if (compact) {
    const occupancy = formatModelLine(status)
    return truncate(`${mark}  ${occupancy}`, width)
  }
  const diagCount = Math.max(3, width - mark.length - 2)
  const diags = ICONS.diagonal.repeat(diagCount)
  const top = truncate(`${mark} ${diags}`, width)
  const bottom = truncate(formatModelLine(status), width)
  return `${top}\n${bottom}`
}

/**
 * Crush session sidebar: title, cwd, model, tokens.
 * @param width - sidebar columns.
 * @param title - session title.
 * @param status - model/cwd/token facts.
 * @param home - `$HOME` for path collapsing.
 * @returns sidebar body.
 */
export function renderSidebar(
  width: number,
  title: string | undefined,
  status: StatusModel,
  home: string | undefined,
): string {
  const inner = Math.max(1, width - 2)
  const heading = truncate(title ?? 'New session', inner)
  const cwd = truncate(prettyPath(status.cwd, home), inner)
  const model = truncate(formatModelLine(status), inner)
  const rule = ICONS.section.repeat(Math.min(inner, 24))
  return [heading, cwd, rule, model].join('\n')
}

/**
 * Crush landing page: cwd, model, and a short prompt to start chatting.
 * @param width - main columns.
 * @param status - model/cwd facts.
 * @param home - `$HOME` for path collapsing.
 * @returns landing body.
 */
export function renderLanding(width: number, status: StatusModel, home: string | undefined): string {
  const cwd = prettyPath(status.cwd, home)
  return [
    truncate(cwd, width),
    '',
    truncate(formatModelLine(status), width),
    '',
    truncate('Type a message and press enter. / opens commands.', width),
    truncate(formatHelpLine(status.compact), width),
  ].join('\n')
}

/**
 * First-run guidance when credentials or a model route are missing.
 * @param width - main columns.
 * @param guidance - controller-supplied fact (never a secret).
 * @returns onboarding body.
 */
export function renderOnboarding(width: number, guidance: string): string {
  return [
    truncate(`${PRODUCT_MARK} ${PRODUCT_NAME}`, width),
    '',
    truncate(guidance, width),
    '',
    truncate('Set DEEPSEEK_API_KEY in the environment or $DSH_HOME/.env, then restart.', width),
    truncate('The TUI does not store credentials; it uses the harness credential seam.', width),
  ].join('\n')
}

/**
 * Crush overlay frame: a titled, bordered dialog body.
 * @param width - available columns.
 * @param title - dialog title.
 * @param lines - body lines.
 * @param selected - highlighted row, when the body is a list.
 * @returns framed dialog text.
 */
export function renderOverlay(
  width: number,
  title: string,
  lines: readonly string[],
  selected?: number,
): string {
  const inner = Math.max(8, Math.min(width - 4, 72))
  const bar = ICONS.section.repeat(inner)
  const heading = truncate(title, inner)
  const body = lines.map((line, index) => {
    const prefix = selected === index ? `${ICONS.radioOn} ` : '  '
    return truncate(`${prefix}${line}`, inner)
  })
  return [`┌${bar}┐`, `│ ${heading.padEnd(inner - 2)} │`, `├${bar}┤`, ...body.map(line => `│ ${line.padEnd(inner - 2)} │`), `└${bar}┘`].join('\n')
}

/**
 * Crush help overlay body.
 * @returns help lines.
 */
export function helpLines(): readonly string[] {
  return [
    'ctrl+p  commands',
    'ctrl+l  models',
    'ctrl+s  sessions',
    'ctrl+n  new session',
    'ctrl+g  this help',
    'ctrl+c  quit',
    'enter   send',
    'ctrl+j  newline',
    'esc     cancel / close',
    'tab     change focus',
    'space   expand tool / reasoning (chat focus)',
    '/help   command list',
  ]
}

/**
 * Session-dialog rows.
 * @param sessions - listed sessions.
 * @returns display lines.
 */
export function sessionLines(sessions: readonly SessionRow[]): readonly string[] {
  if (sessions.length === 0) return ['No stored sessions yet.']
  return sessions.map(session => session.title)
}
