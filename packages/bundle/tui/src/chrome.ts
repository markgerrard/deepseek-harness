/**
 * Claude Code-like chrome helpers: landing, onboarding, numbered dialogs,
 * and the slash-command list. Return plain strings for Ink `Text`.
 * @module @deepseek-ai/dsh-tui/chrome
 */

import {
  formatConnectProviderLine,
  maskSecret,
  providerDisplayName,
  type ConnectProviderRow,
} from './connect.ts'
import { formatModelLine, prettyPath, truncate, wrapText, type StatusModel } from './status.ts'
import { ICONS, PRODUCT_MARK, PRODUCT_NAME, PRODUCT_TITLE, PRODUCT_VERSION } from './theme.ts'
import type { SessionRow } from './state.ts'

/**
 * Unused header helper kept so existing imports stay valid. No diagonal
 * ╱ wordmark — Claude Code has no product chrome at the top.
 * @param width - header columns.
 * @param status - model/cwd/token facts.
 * @param _compact - unused compact flag.
 * @returns a single occupancy line.
 */
export function renderHeader(width: number, status: StatusModel, _compact: boolean): string {
  return truncate(formatModelLine(status), width)
}

/**
 * Unused session-sidebar helper. The Claude Code-like layout is single-column.
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
  return [heading, cwd, model].join('\n')
}

/** Per-glyph tone inside one landing-whale row. */
export type WhaleTone = 'block' | 'spray' | 'hole'

/** One coloured run inside a whale row. */
export interface WhaleSegment {
  readonly text: string
  readonly tone: WhaleTone
}

/** One splash-art row: mixed tones, plus joined `text` for string renderers. */
export interface WhaleLine {
  readonly segments: readonly WhaleSegment[]
  readonly text: string
}

function whaleLine(...segments: readonly WhaleSegment[]): WhaleLine {
  return { segments, text: segments.map(segment => segment.text).join('') }
}

/**
 * Distinctive eye cutout in the solid-block whale (block, hole, block).
 * Tests pin this rather than the whole drawing so the composition can be tweaked.
 */
export const WHALE_EYE = '█  █'

/**
 * Side-on solid-block whale splash for the empty landing view.
 * Unicode half/full blocks, one eye hole, blowhole spray. Head faces
 * left (Claude Code-style). Original composition — not the official
 * DeepSeek whale logo.
 */
export const WHALE_ART: readonly WhaleLine[] = [
  whaleLine({ tone: 'spray', text: '▄                     ' }),
  whaleLine({ tone: 'spray', text: '▄▀▄                    ' }),
  whaleLine({ tone: 'block', text: '██████▄▄          ▄▄  ' }),
  whaleLine(
    { tone: 'block', text: '█' },
    { tone: 'hole', text: '  ' },
    { tone: 'block', text: '████████▄▄▄▄▄▄▄████▄' },
  ),
  whaleLine({ tone: 'block', text: '███████████████████████' }),
  whaleLine({ tone: 'block', text: '▀███████████████████▀ ' }),
  whaleLine({ tone: 'block', text: '▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀   ' }),
]

/** Narrow-terminal whale when the full drawing will clip. */
export const WHALE_ART_COMPACT: readonly WhaleLine[] = [
  whaleLine({ tone: 'spray', text: '▄          ' }),
  whaleLine({ tone: 'spray', text: '▄▀▄         ' }),
  whaleLine({ tone: 'block', text: '████▄▄   ▄▄' }),
  whaleLine(
    { tone: 'block', text: '█' },
    { tone: 'hole', text: '  ' },
    { tone: 'block', text: '████▄███' },
  ),
  whaleLine({ tone: 'block', text: '▀█████████▀' }),
  whaleLine({ tone: 'block', text: '▀▀▀▀▀▀▀  ' }),
]

/**
 * Pick whale splash lines that fit `width`.
 * @param width - landing columns.
 * @returns solid-block whale rows with per-segment tones.
 */
export function whaleArt(width: number): readonly WhaleLine[] {
  return width < 32 ? WHALE_ART_COMPACT : WHALE_ART
}

/** Hint under the Claude Code-style landing header (full width, not in the column). */
export const LANDING_HINT = 'Type a message. / opens commands.'

/** Copy for the three-line column beside the whale. */
export interface LandingHeaderCopy {
  readonly title: string
  readonly version: string
  readonly model: string
  readonly cwd: string
  readonly hint: string
}

/**
 * Model line for the landing header: provider display + model, no occupancy.
 * @param status - model/cwd facts.
 * @returns `Cline Pass / cline-pass/deepseek-v4-flash`.
 */
export function formatLandingModelLine(status: StatusModel): string {
  return `${providerDisplayName(status.provider)} / ${status.model}`
}

/**
 * Title, version, model, and cwd for the landing header column.
 * @param status - model/cwd facts.
 * @param home - `$HOME` for path collapsing.
 * @returns left-aligned header copy.
 */
export function landingHeaderCopy(status: StatusModel, home: string | undefined): LandingHeaderCopy {
  return {
    title: PRODUCT_TITLE,
    version: PRODUCT_VERSION,
    model: formatLandingModelLine(status),
    cwd: prettyPath(status.cwd, home),
    hint: LANDING_HINT,
  }
}

/**
 * Full-width hint under the whale + title header.
 * @param width - main columns.
 * @param _status - unused; kept so existing call sites stay valid.
 * @param _home - unused.
 * @returns muted hint line.
 */
export function renderLandingMeta(width: number, _status: StatusModel, _home: string | undefined): string {
  return wrapText(LANDING_HINT, width)
}

/**
 * Claude Code-like landing: left-facing whale beside title/version, model, cwd.
 * Hint sits under the header block.
 * @param width - main columns.
 * @param status - model/cwd facts.
 * @param home - `$HOME` for path collapsing.
 * @returns landing body.
 */
export function renderLanding(width: number, status: StatusModel, home: string | undefined): string {
  const art = whaleArt(width)
  const header = landingHeaderCopy(status, home)
  const beside = [`${header.title} ${header.version}`, header.model, header.cwd]
  const artWidth = Math.max(1, ...art.map(line => line.text.length))
  const rows = art.map((line, index) => {
    const extra = beside[index]
    if (extra === undefined) return line.text
    const pad = ' '.repeat(Math.max(0, artWidth - line.text.length))
    return `${line.text}${pad} ${extra}`
  })
  return [...rows, '', wrapText(header.hint, width)].join('\n')
}

/**
 * First-run guidance when no connectable provider has a key.
 * @param width - main columns.
 * @param guidance - controller-supplied fact (never a secret).
 * @returns onboarding body.
 */
export function renderOnboarding(width: number, guidance: string): string {
  return [
    wrapText(`${PRODUCT_MARK} ${PRODUCT_NAME}`, width),
    '',
    wrapText(guidance, width),
    '',
    wrapText('Use /connect to paste an OpenCode Go, Cline Pass, or DeepSeek key.', width),
    wrapText('Keys are stored through the harness credential seam, never printed.', width),
  ].join('\n')
}

/**
 * Prefix a list row with the Claude Code-like ❯ selector.
 * @param line - row text.
 * @param selected - whether this row is highlighted.
 * @returns the prefixed line.
 */
export function formatSelectedRow(line: string, selected: boolean): string {
  return selected ? `${ICONS.selector} ${line}` : `  ${line}`
}

/**
 * Numbered option row (`1. Yes`) with a ❯ on the selected index.
 * @param index - zero-based option index.
 * @param label - option label.
 * @param selected - selected index.
 * @returns one option line.
 */
export function formatNumberedOption(index: number, label: string, selected: number): string {
  return formatSelectedRow(`${index + 1}. ${label}`, selected === index)
}

/**
 * Simple Claude Code-like list (commands, models, sessions). No framed overlay.
 * @param width - available columns.
 * @param title - optional heading (empty string skips it).
 * @param lines - body lines.
 * @param selected - highlighted row, when the body is a list.
 * @returns list text.
 */
export function renderOverlay(
  width: number,
  title: string,
  lines: readonly string[],
  selected?: number,
): string {
  const inner = Math.max(8, width)
  const body = lines.map((line, index) => {
    if (selected === undefined) return truncate(line, inner)
    return truncate(formatSelectedRow(line, selected === index), inner)
  })
  if (title === '') return body.join('\n')
  return [truncate(title, inner), '', ...body].join('\n')
}

/**
 * "Do you want to proceed?" permission / choice list.
 * @param width - available columns.
 * @param prompt - question text.
 * @param options - numbered labels.
 * @param selected - highlighted option.
 * @returns dialog text.
 */
export function renderChoiceDialog(
  width: number,
  prompt: string,
  options: readonly string[],
  selected: number,
): string {
  const inner = Math.max(8, width)
  return [
    truncate(prompt, inner),
    '',
    ...options.map((option, index) => truncate(formatNumberedOption(index, option, selected), inner)),
  ].join('\n')
}

/**
 * Numbered Yes/No pair. No is selected by default (`selectedNope`).
 * @param selectedNope - whether No is the selected option.
 * @returns two option lines.
 */
export function formatQuitButtons(selectedNope: boolean): string {
  const selected = selectedNope ? 1 : 0
  return [formatNumberedOption(0, 'Yes', selected), formatNumberedOption(1, 'No', selected)].join('\n')
}

/**
 * Claude Code-like quit confirmation: numbered Yes/No, No selected by default.
 * @param width - available columns.
 * @param selectedNope - whether No is selected.
 * @returns quit dialog text.
 */
export function renderQuitDialog(width: number, selectedNope: boolean): string {
  const selected = selectedNope ? 1 : 0
  return [
    renderChoiceDialog(width, 'Do you want to quit?', ['Yes', 'No'], selected),
    '',
    'Ctrl-C twice to quit without confirmation.',
  ].join('\n')
}

/**
 * Permission dialog: tool facts above a numbered proceed list.
 * @param width - available columns.
 * @param toolName - tool being approved.
 * @param reason - optional reason (never a secret).
 * @param selected - 0 = Yes, 1 = No.
 * @returns dialog text.
 */
export function renderApprovalDialog(
  width: number,
  toolName: string,
  reason: string | undefined,
  selected: number,
): string {
  const inner = Math.max(8, width)
  const head = reason === undefined || reason === ''
    ? truncate(toolName, inner)
    : [truncate(toolName, inner), truncate(reason, inner)].join('\n')
  return `${head}\n\n${renderChoiceDialog(width, 'Do you want to proceed?', ['Yes', 'No'], selected)}`
}

/**
 * Connect API-key dialog with a masked field. The raw key never appears.
 * @param width - available columns.
 * @param displayName - provider label.
 * @param value - typed key (masked in the output).
 * @param apiKeyEnv - writable credential ref shown as the store name.
 * @param error - optional failure text (never a secret).
 * @returns connect-key dialog text.
 */
export function renderConnectKeyDialog(
  width: number,
  displayName: string,
  value: string,
  apiKeyEnv: string,
  error?: string,
): string {
  const masked = value.length === 0 ? '' : maskSecret(value)
  const field = value.length === 0 ? '> Enter your API key...' : `> ${masked}`
  const lines = [
    `Enter your ${displayName} Key.`,
    '',
    field,
    '',
    `Stored as ${apiKeyEnv} through the harness credential seam.`,
  ]
  if (error !== undefined) lines.push('', error)
  return renderOverlay(width, 'Connect', lines)
}

/**
 * Connect provider-picker lines.
 * @param rows - configured/writable facts.
 * @returns display lines.
 */
export function connectProviderLines(rows: readonly ConnectProviderRow[]): readonly string[] {
  if (rows.length === 0) return ['No connectable providers.']
  return rows.map(formatConnectProviderLine)
}

/**
 * Help overlay body.
 * @returns help lines.
 */
export function helpLines(): readonly string[] {
  return [
    '?       shortcuts',
    'ctrl+p  commands',
    'ctrl+l  models',
    'ctrl+s  sessions',
    'ctrl+n  new session',
    'ctrl+g  this help',
    'ctrl+c  cancel / clear / quit',
    'enter   send (queues while Working)',
    'ctrl+t  steer this turn (next step)',
    'shift+tab  cycle permission mode',
    'pgup / shift+up    scroll transcript up',
    'pgdn / shift+down  scroll transcript down (re-pin at bottom)',
    'up      take back last queued / history',
    'ctrl+r  reverse search history',
    'ctrl+j  newline',
    'ctrl+left/right  or  esc b/f  word jump',
    'esc     cancel / close',
    'esc esc rewind last prompt',
    'tab     change focus',
    'ctrl+o  expand tool / reasoning / workflow',
    '/connect  paste a provider API key',
    '/clear  new visual transcript',
    '/compact  compact session history',
    '/cost   token occupancy',
    '/agents  list subagents',
    '/attach  attach a local image path',
    '/help   command list',
    '!cmd    run a shell command',
    '@path   complete a cwd path',
  ]
}

/**
 * One muted next-turn queue row above the clock / prompt.
 * @param index - 1-based position in `agent.inbox.nextTurn`.
 * @param text - queued prompt text.
 * @param width - available columns.
 * @returns `queued 1  look at tests`, truncated to one line.
 */
export function formatQueuedLine(index: number, text: string, width: number): string {
  return formatInboxLine('queued', index, text, width)
}

/**
 * One muted next-step steer row above the queued rows / clock / prompt.
 * @param index - 1-based position in `agent.inbox.nextStep`.
 * @param text - steer prompt text.
 * @param width - available columns.
 * @returns `steer 1  look at tests`, truncated to one line.
 */
export function formatSteerLine(index: number, text: string, width: number): string {
  return formatInboxLine('steer', index, text, width)
}

/**
 * One muted inbox row (`queued 1  …` / `steer 1  …`), truncated to one line.
 * @param label - `queued` or `steer`.
 * @param index - 1-based position.
 * @param text - prompt text.
 * @param width - available columns.
 * @returns the collapsed, truncated row.
 */
function formatInboxLine(label: string, index: number, text: string, width: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return truncate(`${label} ${index}  ${collapsed}`, width)
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

/**
 * Token-occupancy overlay body from `tokenMeter` facts.
 * @param used - measured tokens, when known.
 * @param window - model context window, when known.
 * @returns overlay lines (never secrets).
 */
export function formatCostLines(used: number | undefined, window: number | undefined): readonly string[] {
  if (used === undefined) return ['No token measurement yet.']
  if (window !== undefined && window > 0) {
    const pct = Math.min(100, Math.round((used / window) * 100))
    return [`${used} / ${window} tokens`, `${pct}% of context`]
  }
  return [`${used} tokens`]
}

/**
 * Compact swarm status above the prompt when any child is running.
 * @param total - listed child count.
 * @param running - children whose live status is running.
 * @returns `agents 3  ·  1 running`.
 */
export function formatAgentsLine(total: number, running: number): string {
  return `agents ${total}  ·  ${running} running`
}

/**
 * Overlay rows for `/agents`.
 * @param agents - listed children.
 * @returns display lines.
 */
export function agentLines(
  agents: readonly { readonly name: string; readonly mode: string; readonly status: string }[],
): readonly string[] {
  if (agents.length === 0) return ['No subagents.']
  return agents.map(agent => `${agent.name}  ${agent.mode}  ${agent.status}`)
}
