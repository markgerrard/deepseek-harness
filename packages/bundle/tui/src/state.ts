/**
 * Crush-style TUI state machine: screen, focus, overlays, editor, and
 * transcript expansion. Reducers are pure so unit tests do not need Ink.
 * @module @deepseek-ai/dsh-tui/state
 */

import { isPaletteOpen, routeLine } from './commands.ts'
import { matches, KEYS } from './keys.ts'
import { isCompact } from './layout.ts'
import { toggleId, type TranscriptExpansion } from './transcript.ts'

/** Crush UI screens. */
export type Screen = 'onboarding' | 'landing' | 'chat'

/** Crush focus targets. */
export type Focus = 'editor' | 'chat' | 'sidebar'

/** Crush overlay dialogs. */
export type Overlay =
  | { readonly kind: 'none' }
  | { readonly kind: 'commands'; readonly query: string; readonly selected: number }
  | { readonly kind: 'models'; readonly selected: number }
  | { readonly kind: 'sessions'; readonly selected: number }
  | { readonly kind: 'help' }
  | {
    readonly kind: 'approval'
    readonly toolName: string
    readonly reason?: string
    readonly selected: number
  }
  | {
    readonly kind: 'question'
    readonly prompt: string
    readonly options: readonly string[]
    readonly selected: number
    readonly multi: boolean
    readonly chosen: readonly number[]
  }

/** Session row for the Crush sessions dialog / sidebar. */
export interface SessionRow {
  readonly id: string
  readonly title: string
  readonly cwd?: string
  readonly createdAt: number
}

/** Model row for the Crush models dialog. */
export interface ModelRow {
  readonly provider: string
  readonly id: string
  readonly name: string
}

/** Pure Crush UI state. Service I/O lives on the controller. */
export interface TuiState {
  readonly screen: Screen
  readonly focus: Focus
  readonly overlay: Overlay
  readonly input: string
  readonly cursor: number
  readonly width: number
  readonly height: number
  readonly expansion: TranscriptExpansion
  readonly sessions: readonly SessionRow[]
  readonly models: readonly ModelRow[]
  readonly sessionId?: string
  readonly title?: string
  readonly provider: string
  readonly model: string
  readonly cwd: string
  readonly usedTokens?: number
  readonly contextWindow?: number
  readonly busy: boolean
  readonly guidance?: string
  /** Filtered command-palette length used to clamp overlay selection. */
  readonly paletteLength: number
}

/** Pure UI actions. Controller-owned I/O is not represented here. */
export type TuiAction =
  | { readonly type: 'resize'; readonly width: number; readonly height: number }
  | { readonly type: 'set-input'; readonly input: string; readonly cursor: number }
  | { readonly type: 'open-overlay'; readonly overlay: Overlay }
  | { readonly type: 'close-overlay' }
  | { readonly type: 'move-overlay'; readonly delta: number }
  | { readonly type: 'set-focus'; readonly focus: Focus }
  | { readonly type: 'toggle-expand'; readonly id: string; readonly target: 'tools' | 'reasoning' }
  | { readonly type: 'set-sessions'; readonly sessions: readonly SessionRow[] }
  | { readonly type: 'set-models'; readonly models: readonly ModelRow[] }
  | { readonly type: 'set-session'; readonly sessionId: string; readonly title?: string }
  | { readonly type: 'set-model'; readonly provider: string; readonly model: string }
  | { readonly type: 'set-tokens'; readonly usedTokens?: number; readonly contextWindow?: number }
  | { readonly type: 'set-busy'; readonly busy: boolean }
  | { readonly type: 'set-screen'; readonly screen: Screen }
  | { readonly type: 'set-guidance'; readonly guidance?: string }
  | { readonly type: 'set-palette-length'; readonly paletteLength: number }
  | { readonly type: 'clear-input' }

/**
 * Initial Crush landing state.
 * @param seed - boot-time facts the controller already knows.
 * @returns a landing-state snapshot.
 */
export function initialState(seed: {
  width: number
  height: number
  provider: string
  model: string
  cwd: string
  guidance?: string
}): TuiState {
  return {
    screen: seed.guidance === undefined ? 'landing' : 'onboarding',
    focus: 'editor',
    overlay: { kind: 'none' },
    input: '',
    cursor: 0,
    width: seed.width,
    height: seed.height,
    expansion: { tools: new Set(), reasoning: new Set() },
    sessions: [],
    models: [],
    provider: seed.provider,
    model: seed.model,
    cwd: seed.cwd,
    busy: false,
    paletteLength: 0,
    ...(seed.guidance === undefined ? {} : { guidance: seed.guidance }),
  }
}

/**
 * Clamp a selected index into `[0, length)`.
 * @param selected - current index.
 * @param length - list length.
 * @param delta - movement.
 * @returns the clamped index, or 0 when the list is empty.
 */
export function moveSelection(selected: number, length: number, delta: number): number {
  if (length <= 0) return 0
  const next = selected + delta
  if (next < 0) return 0
  if (next >= length) return length - 1
  return next
}

/**
 * Reduce one pure UI action.
 * @param state - current Crush UI state.
 * @param action - UI action.
 * @returns the next state.
 */
export function reduce(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case 'resize':
      return { ...state, width: action.width, height: action.height }
    case 'set-input': {
      const input = action.input
      const overlay = state.overlay.kind === 'commands' || (state.overlay.kind === 'none' && isPaletteOpen(input))
        ? { kind: 'commands' as const, query: input, selected: state.overlay.kind === 'commands' ? state.overlay.selected : 0 }
        : state.overlay.kind === 'commands' && !isPaletteOpen(input)
          ? { kind: 'none' as const }
          : state.overlay
      return { ...state, input, cursor: action.cursor, overlay }
    }
    case 'open-overlay':
      return { ...state, overlay: action.overlay }
    case 'close-overlay':
      return { ...state, overlay: { kind: 'none' } }
    case 'move-overlay': {
      const overlay = state.overlay
      if (overlay.kind === 'none' || overlay.kind === 'help') return state
      if (overlay.kind === 'question') {
        return { ...state, overlay: { ...overlay, selected: moveSelection(overlay.selected, overlay.options.length, action.delta) } }
      }
      const length = overlay.kind === 'models' ? state.models.length
        : overlay.kind === 'sessions' ? state.sessions.length
          : overlay.kind === 'approval' ? 2
            : overlay.kind === 'commands' ? state.paletteLength
              : 0
      return { ...state, overlay: { ...overlay, selected: moveSelection(overlay.selected, length, action.delta) } }
    }
    case 'set-focus':
      return { ...state, focus: action.focus }
    case 'toggle-expand': {
      const current = action.target === 'tools' ? state.expansion.tools : state.expansion.reasoning
      const next = toggleId(current, action.id)
      return {
        ...state,
        expansion: action.target === 'tools'
          ? { ...state.expansion, tools: next }
          : { ...state.expansion, reasoning: next },
      }
    }
    case 'set-sessions':
      return { ...state, sessions: action.sessions }
    case 'set-models':
      return { ...state, models: action.models }
    case 'set-session':
      return {
        ...state,
        sessionId: action.sessionId,
        ...(action.title === undefined ? {} : { title: action.title }),
        screen: state.screen === 'onboarding' ? 'onboarding' : 'chat',
      }
    case 'set-model':
      return { ...state, provider: action.provider, model: action.model }
    case 'set-tokens':
      return { ...state, usedTokens: action.usedTokens, contextWindow: action.contextWindow }
    case 'set-busy':
      return { ...state, busy: action.busy }
    case 'set-screen':
      return { ...state, screen: action.screen }
    case 'set-guidance':
      return { ...state, guidance: action.guidance, screen: action.guidance === undefined ? 'landing' : 'onboarding' }
    case 'set-palette-length':
      return { ...state, paletteLength: action.paletteLength }
    case 'clear-input':
      return { ...state, input: '', cursor: 0, overlay: state.overlay.kind === 'commands' ? { kind: 'none' } : state.overlay }
    default: {
      const _exhaustive: never = action
      return _exhaustive
    }
  }
}

/**
 * Crush key → overlay/focus intent. Does not perform I/O.
 * @param state - current UI state.
 * @param key - Ink key name.
 * @returns a UI action, or undefined when the key is not a chrome binding.
 */
export function chromeAction(state: TuiState, key: string): TuiAction | undefined {
  if (matches(KEYS.quit, key)) return undefined
  if (state.overlay.kind !== 'none') {
    if (matches(KEYS.cancel, key)) return { type: 'close-overlay' }
    if (key === 'up' || key === 'k') return { type: 'move-overlay', delta: -1 }
    if (key === 'down' || key === 'j') return { type: 'move-overlay', delta: 1 }
    return undefined
  }
  if (matches(KEYS.help, key)) return { type: 'open-overlay', overlay: { kind: 'help' } }
  if (matches(KEYS.commands, key)) return { type: 'open-overlay', overlay: { kind: 'commands', query: state.input, selected: 0 } }
  if (matches(KEYS.models, key)) return { type: 'open-overlay', overlay: { kind: 'models', selected: 0 } }
  if (matches(KEYS.sessions, key)) return { type: 'open-overlay', overlay: { kind: 'sessions', selected: 0 } }
  if (matches(KEYS.tab, key)) {
    const compact = isCompact(state.width, state.height)
    const order: Focus[] = compact ? ['editor', 'chat'] : ['editor', 'chat', 'sidebar']
    const index = order.indexOf(state.focus)
    return { type: 'set-focus', focus: order[(index + 1) % order.length] ?? 'editor' }
  }
  return undefined
}

export { routeLine }
