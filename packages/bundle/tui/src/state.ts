/**
 * Claude Code-like TUI state machine: screen, focus, overlays, editor, and
 * transcript expansion. Reducers are pure so unit tests do not need Ink.
 * @module @deepseek-ai/dsh-tui/state
 */

import type { ConnectProviderRow } from './connect.ts'
import { isPaletteOpen, routeLine } from './commands.ts'
import { matches, KEYS } from './keys.ts'
import { cookingVerb, type StatusNotice } from './status.ts'
import { toggleId, type TranscriptExpansion } from './transcript.ts'

/** Claude Code-like UI screens. */
export type Screen = 'onboarding' | 'landing' | 'chat'

/** Claude Code-like focus targets. */
export type Focus = 'editor' | 'chat' | 'sidebar'

/** Claude Code-like overlay dialogs. */
export type Overlay =
  | { readonly kind: 'none' }
  | { readonly kind: 'commands'; readonly query: string; readonly selected: number }
  | { readonly kind: 'models'; readonly selected: number }
  | { readonly kind: 'sessions'; readonly selected: number }
  | { readonly kind: 'help' }
  | { readonly kind: 'quit'; readonly selectedNope: boolean }
  | { readonly kind: 'connect-provider'; readonly selected: number }
  | {
    readonly kind: 'connect-key'
    readonly providerId: string
    readonly value: string
    readonly error?: string
  }
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

/** Intent produced by {@link resolveQuitKey}. */
export type QuitIntent =
  | { readonly type: 'open' }
  | { readonly type: 'exit' }
  | { readonly type: 'dismiss' }
  | { readonly type: 'toggle' }
  | { readonly type: 'ignore' }

/** Session row for the sessions dialog. */
export interface SessionRow {
  readonly id: string
  readonly title: string
  readonly cwd?: string
  readonly createdAt: number
}

/** Frozen duration line left in the transcript after a turn completes. */
export interface TurnClock {
  readonly id: string
  readonly ms: number
  readonly verb: string
}

/** Model row for the models dialog. */
export interface ModelRow {
  readonly provider: string
  readonly id: string
  readonly name: string
}

/** Pure Claude Code-like UI state. Service I/O lives on the controller. */
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
  readonly connectProviders: readonly ConnectProviderRow[]
  readonly sessionId?: string
  readonly title?: string
  readonly provider: string
  readonly model: string
  readonly cwd: string
  readonly usedTokens?: number
  readonly contextWindow?: number
  readonly busy: boolean
  /** Epoch ms when the current turn became busy. */
  readonly turnStartedAt?: number
  /** Frozen duration of the last completed turn. */
  readonly lastTurnMs?: number
  /** Session token count snapshotted when the current turn became busy. */
  readonly turnTokenBase?: number
  /** Finished-turn clocks kept in transcript history. */
  readonly turnClocks: readonly TurnClock[]
  readonly guidance?: string
  readonly notice?: StatusNotice
  /** Filtered command-palette length used to clamp overlay selection. */
  readonly paletteLength: number
  /** Ghost follow-up shown as the empty-editor placeholder after a completed turn. */
  readonly suggestion?: string
}

/** Pure UI actions. Controller-owned I/O is not represented here. */
export type TuiAction =
  | { readonly type: 'resize'; readonly width: number; readonly height: number }
  | { readonly type: 'set-input'; readonly input: string; readonly cursor: number }
  | { readonly type: 'open-overlay'; readonly overlay: Overlay }
  | { readonly type: 'close-overlay' }
  | { readonly type: 'move-overlay'; readonly delta: number }
  | { readonly type: 'toggle-quit' }
  | { readonly type: 'set-connect-key'; readonly value: string }
  | { readonly type: 'set-connect-error'; readonly error?: string }
  | { readonly type: 'set-connect-providers'; readonly connectProviders: readonly ConnectProviderRow[] }
  | { readonly type: 'set-focus'; readonly focus: Focus }
  | { readonly type: 'toggle-expand'; readonly id: string; readonly target: 'tools' | 'reasoning' }
  | { readonly type: 'set-sessions'; readonly sessions: readonly SessionRow[] }
  | { readonly type: 'set-models'; readonly models: readonly ModelRow[] }
  | { readonly type: 'set-session'; readonly sessionId: string; readonly title?: string }
  | { readonly type: 'set-model'; readonly provider: string; readonly model: string }
  | { readonly type: 'set-tokens'; readonly usedTokens?: number; readonly contextWindow?: number }
  | { readonly type: 'set-busy'; readonly busy: boolean; readonly at?: number }
  | { readonly type: 'set-screen'; readonly screen: Screen }
  | { readonly type: 'set-guidance'; readonly guidance?: string }
  | { readonly type: 'set-notice'; readonly notice?: StatusNotice }
  | { readonly type: 'set-palette-length'; readonly paletteLength: number }
  | { readonly type: 'clear-input' }
  | { readonly type: 'set-suggestion'; readonly suggestion?: string }

/**
 * Initial Claude Code-like landing state.
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
    connectProviders: [],
    provider: seed.provider,
    model: seed.model,
    cwd: seed.cwd,
    busy: false,
    turnClocks: [],
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
 * Quit-dialog key map: first ctrl+c opens; second ctrl+c / y quits;
 * n / esc dismisses; left/right/tab toggles Yes/No; enter/space confirms
 * the selected option (No is the default).
 * @param overlayKind - current overlay kind.
 * @param selectedNope - whether No is the selected quit option.
 * @param key - Ink key name.
 * @returns the quit intent; `ignore` leaves the key to other handlers.
 */
export function resolveQuitKey(overlayKind: Overlay['kind'], selectedNope: boolean, key: string): QuitIntent {
  if (overlayKind === 'quit') {
    if (key === 'ctrl+c' || key === 'y' || key === 'Y') return { type: 'exit' }
    if (key === 'n' || key === 'N' || key === 'escape' || key === 'esc') return { type: 'dismiss' }
    if (key === 'left' || key === 'right' || key === 'tab') return { type: 'toggle' }
    if (key === 'return' || key === 'enter' || key === ' ') {
      return selectedNope ? { type: 'dismiss' } : { type: 'exit' }
    }
    return { type: 'ignore' }
  }
  if (key === 'ctrl+c') return { type: 'open' }
  return { type: 'ignore' }
}

/**
 * Overlay kinds whose lists move with up/down.
 * @param kind - overlay kind.
 * @returns true when `move-overlay` applies.
 */
function isListOverlay(kind: Overlay['kind']): boolean {
  return kind === 'commands' || kind === 'models' || kind === 'sessions'
    || kind === 'connect-provider' || kind === 'approval' || kind === 'question'
}

/**
 * Reduce one pure UI action.
 * @param state - current Claude Code-like UI state.
 * @param action - UI action.
 * @returns the next state.
 */
export function reduce(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case 'resize':
      return { ...state, width: action.width, height: action.height }
    case 'set-input': {
      const input = action.input
      const overlay = isPaletteOpen(input)
        ? {
          kind: 'commands' as const,
          query: input,
          selected: state.overlay.kind === 'commands' ? state.overlay.selected : 0,
        }
        : state.overlay.kind === 'commands'
          ? { kind: 'none' as const }
          : state.overlay
      const next = { ...state, input, cursor: action.cursor, overlay }
      if (input === '') return next
      const { suggestion: _cleared, ...rest } = next
      return rest
    }
    case 'open-overlay':
      return { ...state, overlay: action.overlay }
    case 'close-overlay':
      return { ...state, overlay: { kind: 'none' } }
    case 'move-overlay': {
      const overlay = state.overlay
      if (overlay.kind === 'none' || overlay.kind === 'help' || overlay.kind === 'quit' || overlay.kind === 'connect-key') {
        return state
      }
      if (overlay.kind === 'question') {
        return { ...state, overlay: { ...overlay, selected: moveSelection(overlay.selected, overlay.options.length, action.delta) } }
      }
      const length = overlay.kind === 'models' ? state.models.length
        : overlay.kind === 'sessions' ? state.sessions.length
          : overlay.kind === 'connect-provider' ? state.connectProviders.length
            : overlay.kind === 'approval' ? 2
              : overlay.kind === 'commands' ? state.paletteLength
                : 0
      return { ...state, overlay: { ...overlay, selected: moveSelection(overlay.selected, length, action.delta) } }
    }
    case 'toggle-quit':
      if (state.overlay.kind !== 'quit') return state
      return { ...state, overlay: { kind: 'quit', selectedNope: !state.overlay.selectedNope } }
    case 'set-connect-key':
      if (state.overlay.kind !== 'connect-key') return state
      return { ...state, overlay: { ...state.overlay, value: action.value } }
    case 'set-connect-error':
      if (state.overlay.kind !== 'connect-key') return state
      return {
        ...state,
        overlay: action.error === undefined
          ? { kind: 'connect-key', providerId: state.overlay.providerId, value: state.overlay.value }
          : { ...state.overlay, error: action.error },
      }
    case 'set-connect-providers':
      return { ...state, connectProviders: action.connectProviders }
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
      return {
        ...state,
        ...(action.usedTokens === undefined ? {} : { usedTokens: action.usedTokens }),
        ...(action.contextWindow === undefined ? {} : { contextWindow: action.contextWindow }),
      }
    case 'set-busy': {
      const at = action.at ?? Date.now()
      if (action.busy) {
        if (state.busy) return state
        const { lastTurnMs: _cleared, suggestion: _suggestion, ...rest } = state
        return {
          ...rest,
          busy: true,
          turnStartedAt: at,
          ...(state.usedTokens === undefined ? {} : { turnTokenBase: state.usedTokens }),
        }
      }
      if (state.turnStartedAt === undefined) {
        const { turnStartedAt: _started, turnTokenBase: _base, ...rest } = state
        return { ...rest, busy: false }
      }
      const ms = Math.max(0, at - state.turnStartedAt)
      const { turnStartedAt: _started, turnTokenBase: _base, ...rest } = state
      return {
        ...rest,
        busy: false,
        lastTurnMs: ms,
        turnClocks: [...state.turnClocks, {
          id: `clock:${state.turnClocks.length}:${at}`,
          ms,
          verb: cookingVerb(state.turnClocks.length),
        }],
      }
    }
    case 'set-screen':
      return { ...state, screen: action.screen }
    case 'set-guidance': {
      if (action.guidance !== undefined) {
        return { ...state, guidance: action.guidance, screen: 'onboarding' }
      }
      const { guidance: _cleared, ...rest } = state
      return { ...rest, screen: state.screen === 'onboarding' ? 'landing' : state.screen }
    }
    case 'set-notice': {
      if (action.notice !== undefined) return { ...state, notice: action.notice }
      const { notice: _cleared, ...rest } = state
      return rest
    }
    case 'set-palette-length':
      return { ...state, paletteLength: action.paletteLength }
    case 'clear-input': {
      const { suggestion: _cleared, ...rest } = state
      return { ...rest, input: '', cursor: 0, overlay: state.overlay.kind === 'commands' ? { kind: 'none' } : state.overlay }
    }
    case 'set-suggestion': {
      if (action.suggestion === undefined || action.suggestion === '') {
        const { suggestion: _cleared, ...rest } = state
        return rest
      }
      return { ...state, suggestion: action.suggestion }
    }
    default: {
      const _exhaustive: never = action
      return _exhaustive
    }
  }
}

/**
 * Chrome key → overlay/focus intent. Does not perform I/O. Quit keys are
 * resolved by {@link resolveQuitKey} in the controller.
 * @param state - current UI state.
 * @param key - Ink key name.
 * @returns a UI action, or undefined when the key is not a chrome binding.
 */
export function chromeAction(state: TuiState, key: string): TuiAction | undefined {
  if (matches(KEYS.quit, key)) return undefined
  if (state.overlay.kind === 'quit') return undefined
  if (state.overlay.kind !== 'none') {
    if (matches(KEYS.cancel, key)) return { type: 'close-overlay' }
    if (state.overlay.kind === 'connect-key' || state.overlay.kind === 'help') return undefined
    if ((key === 'up' || key === 'k') && isListOverlay(state.overlay.kind)) {
      return { type: 'move-overlay', delta: -1 }
    }
    if ((key === 'down' || key === 'j') && isListOverlay(state.overlay.kind)) {
      return { type: 'move-overlay', delta: 1 }
    }
    return undefined
  }
  if (matches(KEYS.cancel, key) && state.suggestion !== undefined && state.suggestion !== '') {
    return { type: 'set-suggestion' }
  }
  if (matches(KEYS.help, key)) return { type: 'open-overlay', overlay: { kind: 'help' } }
  if (matches(KEYS.commands, key)) return { type: 'open-overlay', overlay: { kind: 'commands', query: state.input, selected: 0 } }
  if (matches(KEYS.models, key)) return { type: 'open-overlay', overlay: { kind: 'models', selected: 0 } }
  if (matches(KEYS.sessions, key)) return { type: 'open-overlay', overlay: { kind: 'sessions', selected: 0 } }
  if (matches(KEYS.tab, key)) {
    if (state.input === '' && state.suggestion !== undefined && state.suggestion !== '') {
      return { type: 'set-input', input: state.suggestion, cursor: state.suggestion.length }
    }
    const order: Focus[] = ['editor', 'chat']
    const index = order.indexOf(state.focus)
    return { type: 'set-focus', focus: order[(index + 1) % order.length] ?? 'editor' }
  }
  return undefined
}

export { routeLine }
