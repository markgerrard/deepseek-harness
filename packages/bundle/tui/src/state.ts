/**
 * Claude Code-like TUI state machine: screen, focus, overlays, editor, and
 * transcript expansion. Reducers are pure so unit tests do not need Ink.
 * @module @deepseek-ai/dsh-tui/state
 */

import type { ConnectProviderRow } from './connect.ts'
import { isPaletteOpen, routeLine } from './commands.ts'
import { applyAtCompletion, type FileRow } from './files.ts'
import { matches, KEYS } from './keys.ts'
import { applyPromptKey } from './prompt.ts'
import {
  recallHistory,
  reverseSearchHistory,
  pushHistory as appendHistory,
} from './history.ts'
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
  | { readonly kind: 'cost' }
  | { readonly kind: 'agents'; readonly selected: number }
  | { readonly kind: 'files'; readonly selected: number }
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
  | { readonly type: 'cancel-turn' }
  | { readonly type: 'clear-input' }

/** Session row for the sessions dialog. */
export interface SessionRow {
  readonly id: string
  readonly title: string
  readonly cwd?: string
  readonly createdAt: number
}

/** One inbox prompt waiting in `nextTurn` or `nextStep`. */
export interface QueuedPrompt {
  readonly id: string
  readonly text: string
}

/** Frozen duration line left in the transcript after a turn completes. */
export interface TurnClock {
  readonly id: string
  readonly ms: number
  readonly verb: string
}

/** One subagent row for the /agents overlay. */
export interface AgentRow {
  readonly id: string
  readonly name: string
  readonly mode: string
  readonly status: 'running' | 'idle' | 'ready'
}

export type { FileRow }

/** One local command / shell card kept off the session log. */
export interface LocalCard {
  readonly id: string
  readonly text: string
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
  /** Last killed prompt text for readline yank (`ctrl+y`). */
  readonly kill?: string
  readonly width: number
  readonly height: number
  readonly expansion: TranscriptExpansion
  readonly sessions: readonly SessionRow[]
  readonly models: readonly ModelRow[]
  readonly agents: readonly AgentRow[]
  readonly files: readonly FileRow[]
  readonly localCards: readonly LocalCard[]
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
  /** Visible next-turn inbox, sourced from `agent.inbox.nextTurn`. */
  readonly queued: readonly QueuedPrompt[]
  /** Visible next-step inbox, sourced from `agent.inbox.nextStep`. */
  readonly steering: readonly QueuedPrompt[]
  /** Submitted prompts from this session, oldest first. */
  readonly history: readonly string[]
  /** Index into `history` while Up/Down / Ctrl+R is browsing. */
  readonly historyIndex?: number
  /** Editor draft captured when history browse started. */
  readonly historyDraft?: string
  /** Ctrl+R search needle, kept while cycling matches. */
  readonly historyQuery?: string
  /** Hide session events at or below this seq from the visual transcript. */
  readonly clearedSeq?: number
  /** Footer permission label from DSH plan mode + `/permission` presets. */
  readonly permissionMode?: string
  /** True when the transcript follows new output (pin-to-bottom). */
  readonly transcriptPinned: boolean
  /** Top visual line when {@link TuiState.transcriptPinned} is false. */
  readonly transcriptStart: number
}

/** Pure UI actions. Controller-owned I/O is not represented here. */
export type TuiAction =
  | { readonly type: 'resize'; readonly width: number; readonly height: number }
  | { readonly type: 'set-input'; readonly input: string; readonly cursor: number; readonly kill?: string }
  | { readonly type: 'open-overlay'; readonly overlay: Overlay }
  | { readonly type: 'close-overlay' }
  | { readonly type: 'move-overlay'; readonly delta: number }
  | { readonly type: 'toggle-quit' }
  | { readonly type: 'set-connect-key'; readonly value: string }
  | { readonly type: 'set-connect-error'; readonly error?: string }
  | { readonly type: 'set-connect-providers'; readonly connectProviders: readonly ConnectProviderRow[] }
  | { readonly type: 'set-focus'; readonly focus: Focus }
  | { readonly type: 'toggle-expand'; readonly id: string; readonly target: 'tools' | 'reasoning' | 'workflows' }
  | { readonly type: 'set-sessions'; readonly sessions: readonly SessionRow[] }
  | { readonly type: 'set-models'; readonly models: readonly ModelRow[] }
  | { readonly type: 'set-agents'; readonly agents: readonly AgentRow[] }
  | { readonly type: 'set-files'; readonly files: readonly FileRow[] }
  | { readonly type: 'append-local'; readonly text: string }
  | { readonly type: 'clear-local' }
  | { readonly type: 'accept-file' }
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
  | { readonly type: 'set-queued'; readonly queued: readonly QueuedPrompt[]; readonly steering?: readonly QueuedPrompt[] }
  | { readonly type: 'push-history'; readonly text: string }
  | { readonly type: 'recall-history'; readonly delta: number }
  | { readonly type: 'search-history' }
  | { readonly type: 'clear-history' }
  | { readonly type: 'clear-transcript'; readonly seq: number }
  | { readonly type: 'set-permission-mode'; readonly permissionMode?: string }
  | { readonly type: 'scroll-transcript'; readonly delta: number; readonly contentHeight: number; readonly viewportHeight: number }
  | { readonly type: 'pin-transcript' }

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
    expansion: { tools: new Set(), reasoning: new Set(), workflows: new Set() },
    sessions: [],
    models: [],
    agents: [],
    files: [],
    localCards: [],
    connectProviders: [],
    provider: seed.provider,
    model: seed.model,
    cwd: seed.cwd,
    busy: false,
    turnClocks: [],
    queued: [],
    steering: [],
    history: [],
    paletteLength: 0,
    transcriptPinned: true,
    transcriptStart: 0,
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
 * Claude Code-like Ctrl+C: while a turn is running, first Ctrl+C cancels it
 * (keepInbox). Idle with text clears the editor. Idle empty opens the quit
 * dialog; a second Ctrl+C / y quits. n / esc dismisses; left/right/tab
 * toggles Yes/No; enter/space confirms the selected option (No is default).
 * @param overlayKind - current overlay kind.
 * @param selectedNope - whether No is the selected quit option.
 * @param key - Ink key name.
 * @param context - busy/editor facts so Ctrl+C does not jump to quit mid-turn.
 * @returns the quit intent; `ignore` leaves the key to other handlers.
 */
export function resolveQuitKey(
  overlayKind: Overlay['kind'],
  selectedNope: boolean,
  key: string,
  context: { readonly busy?: boolean; readonly input?: string } = {},
): QuitIntent {
  if (overlayKind === 'quit') {
    if (key === 'ctrl+c' || key === 'y' || key === 'Y') return { type: 'exit' }
    if (key === 'n' || key === 'N' || key === 'escape' || key === 'esc') return { type: 'dismiss' }
    if (key === 'left' || key === 'right' || key === 'tab') return { type: 'toggle' }
    if (key === 'return' || key === 'enter' || key === ' ') {
      return selectedNope ? { type: 'dismiss' } : { type: 'exit' }
    }
    return { type: 'ignore' }
  }
  if (key !== 'ctrl+c') return { type: 'ignore' }
  if (context.busy === true) return { type: 'cancel-turn' }
  if (context.input !== undefined && context.input !== '') return { type: 'clear-input' }
  return { type: 'open' }
}

/**
 * Overlay kinds whose lists move with up/down.
 * @param kind - overlay kind.
 * @returns true when `move-overlay` applies.
 */
function isListOverlay(kind: Overlay['kind']): boolean {
  return kind === 'commands' || kind === 'models' || kind === 'sessions'
    || kind === 'connect-provider' || kind === 'approval' || kind === 'question'
    || kind === 'agents' || kind === 'files'
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
      const { historyIndex: _index, historyDraft: _draft, historyQuery: _query, ...withoutBrowse } = state
      const overlay = isPaletteOpen(input)
        ? {
          kind: 'commands' as const,
          query: input,
          selected: state.overlay.kind === 'commands' ? state.overlay.selected : 0,
        }
        : state.overlay.kind === 'commands'
          ? { kind: 'none' as const }
          : state.overlay
      const next = {
        ...withoutBrowse,
        input,
        cursor: action.cursor,
        overlay,
        history: state.history,
        ...(action.kill === undefined ? {} : { kill: action.kill }),
      }
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
      if (overlay.kind === 'none' || overlay.kind === 'help' || overlay.kind === 'cost' || overlay.kind === 'quit' || overlay.kind === 'connect-key') {
        return state
      }
      if (overlay.kind === 'question') {
        return { ...state, overlay: { ...overlay, selected: moveSelection(overlay.selected, overlay.options.length, action.delta) } }
      }
      const length = overlay.kind === 'models' ? state.models.length
        : overlay.kind === 'sessions' ? state.sessions.length
          : overlay.kind === 'connect-provider' ? state.connectProviders.length
            : overlay.kind === 'agents' ? state.agents.length
              : overlay.kind === 'files' ? state.files.length
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
      const current = action.target === 'tools' ? state.expansion.tools
        : action.target === 'reasoning' ? state.expansion.reasoning
          : state.expansion.workflows
      const next = toggleId(current, action.id)
      return {
        ...state,
        expansion: action.target === 'tools' ? { ...state.expansion, tools: next }
          : action.target === 'reasoning' ? { ...state.expansion, reasoning: next }
            : { ...state.expansion, workflows: next },
      }
    }
    case 'set-sessions':
      return { ...state, sessions: action.sessions }
    case 'set-models':
      return { ...state, models: action.models }
    case 'set-agents':
      return { ...state, agents: action.agents }
    case 'set-files':
      return { ...state, files: action.files }
    case 'append-local':
      return {
        ...state,
        localCards: [...state.localCards, { id: `local:${state.localCards.length}:${action.text.length}`, text: action.text }],
        screen: state.screen === 'onboarding' ? 'onboarding' : 'chat',
      }
    case 'clear-local':
      return { ...state, localCards: [], files: [] }
    case 'accept-file': {
      if (state.overlay.kind !== 'files') return state
      const row = state.files[state.overlay.selected]
      if (row === undefined) return state
      const next = applyAtCompletion(state.input, state.cursor, row.path)
      if (next === undefined) return state
      return {
        ...state,
        input: next.input,
        cursor: next.cursor,
        overlay: row.dir ? { kind: 'files', selected: 0 } : { kind: 'none' },
      }
    }
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
      const { suggestion: _cleared, historyIndex: _i, historyDraft: _d, historyQuery: _q, ...rest } = state
      return { ...rest, input: '', cursor: 0, overlay: state.overlay.kind === 'commands' ? { kind: 'none' } : state.overlay }
    }
    case 'set-suggestion': {
      if (action.suggestion === undefined || action.suggestion === '') {
        const { suggestion: _cleared, ...rest } = state
        return rest
      }
      return { ...state, suggestion: action.suggestion }
    }
    case 'set-queued':
      return { ...state, queued: action.queued, steering: action.steering ?? state.steering }
    case 'push-history':
      return { ...state, history: appendHistory(state.history, action.text) }
    case 'recall-history': {
      const recalled = recallHistory(state, state.input, action.delta)
      return recalled === undefined ? state : applyRecall(state, recalled)
    }
    case 'search-history': {
      const recalled = reverseSearchHistory(state, state.input)
      return recalled === undefined ? state : applyRecall(state, recalled)
    }
    case 'clear-history': {
      const { historyIndex: _i, historyDraft: _d, historyQuery: _q, clearedSeq: _c, ...rest } = state
      return { ...rest, history: [] }
    }
    case 'clear-transcript': {
      const { suggestion: _s, lastTurnMs: _l, ...rest } = state
      return {
        ...rest,
        screen: state.screen === 'onboarding' ? 'onboarding' : 'landing',
        turnClocks: [],
        localCards: [],
        files: [],
        expansion: { tools: new Set(), reasoning: new Set(), workflows: new Set() },
        overlay: { kind: 'none' },
        clearedSeq: action.seq,
        transcriptPinned: true,
        transcriptStart: 0,
      }
    }
    case 'set-permission-mode': {
      if (action.permissionMode === undefined || action.permissionMode === '') {
        const { permissionMode: _cleared, ...rest } = state
        return rest
      }
      return { ...state, permissionMode: action.permissionMode }
    }
    case 'scroll-transcript': {
      const maxStart = Math.max(0, action.contentHeight - Math.max(0, action.viewportHeight))
      const current = state.transcriptPinned
        ? maxStart
        : Math.min(maxStart, Math.max(0, state.transcriptStart))
      const next = Math.min(maxStart, Math.max(0, current + action.delta))
      if (next >= maxStart) return { ...state, transcriptPinned: true, transcriptStart: maxStart }
      return { ...state, transcriptPinned: false, transcriptStart: next }
    }
    case 'pin-transcript':
      return { ...state, transcriptPinned: true, transcriptStart: 0 }
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
  if (matches(KEYS.steer, key)) return undefined
  if (matches(KEYS.permission, key)) return undefined
  if (state.overlay.kind === 'quit') return undefined
  if (state.overlay.kind !== 'none') {
    if (matches(KEYS.cancel, key)) return { type: 'close-overlay' }
    if (state.overlay.kind === 'connect-key' || state.overlay.kind === 'help' || state.overlay.kind === 'cost') return undefined
    if (state.overlay.kind === 'files' && matches(KEYS.tab, key)) return { type: 'accept-file' }
    if ((key === 'up' || key === 'k') && isListOverlay(state.overlay.kind)) {
      return { type: 'move-overlay', delta: -1 }
    }
    if ((key === 'down' || key === 'j') && isListOverlay(state.overlay.kind)) {
      return { type: 'move-overlay', delta: 1 }
    }
    if (state.overlay.kind === 'commands' || state.overlay.kind === 'files') return promptInputAction(state, key)
    return undefined
  }
  if (matches(KEYS.cancel, key) && state.suggestion !== undefined && state.suggestion !== '') {
    return { type: 'set-suggestion' }
  }
  if (matches(KEYS.help, key)) return { type: 'open-overlay', overlay: { kind: 'help' } }
  if (matches(KEYS.commands, key)) return { type: 'open-overlay', overlay: { kind: 'commands', query: state.input, selected: 0 } }
  if (matches(KEYS.models, key)) return { type: 'open-overlay', overlay: { kind: 'models', selected: 0 } }
  if (matches(KEYS.sessions, key)) return { type: 'open-overlay', overlay: { kind: 'sessions', selected: 0 } }
  if ((key === 'right' || key === 'ctrl+f') && state.input === '' && state.suggestion !== undefined && state.suggestion !== '') {
    return { type: 'set-input', input: state.suggestion, cursor: state.suggestion.length }
  }
  if (matches(KEYS.tab, key)) {
    if (state.input === '' && state.suggestion !== undefined && state.suggestion !== '') {
      return { type: 'set-input', input: state.suggestion, cursor: state.suggestion.length }
    }
    const order: Focus[] = ['editor', 'chat']
    const index = order.indexOf(state.focus)
    return { type: 'set-focus', focus: order[(index + 1) % order.length] ?? 'editor' }
  }
  return promptInputAction(state, key)
}

/**
 * Map a readline / editor key onto `set-input` when the prompt is focused.
 * @param state - current UI state.
 * @param key - Ink key name.
 * @returns a `set-input` action, or undefined when the key is not a prompt binding.
 */
function promptInputAction(state: TuiState, key: string): TuiAction | undefined {
  const edit = applyPromptKey(state.input, state.cursor, key, state.kill)
  if (edit === undefined) return undefined
  return {
    type: 'set-input',
    input: edit.input,
    cursor: edit.cursor,
    ...(edit.kill === undefined ? {} : { kill: edit.kill }),
  }
}

/**
 * Apply a history recall onto UI state, omitting browse fields when restoring the draft.
 * @param state - current UI state.
 * @param recalled - recall result.
 * @returns the next state.
 */
function applyRecall(state: TuiState, recalled: {
  readonly input: string
  readonly cursor: number
  readonly historyIndex?: number
  readonly historyDraft?: string
  readonly historyQuery?: string
}): TuiState {
  const { historyIndex: _i, historyDraft: _d, historyQuery: _q, suggestion: _s, ...rest } = state
  return {
    ...rest,
    input: recalled.input,
    cursor: recalled.cursor,
    overlay: state.overlay.kind === 'commands' ? { kind: 'none' } : state.overlay,
    ...(recalled.historyIndex === undefined ? {} : { historyIndex: recalled.historyIndex }),
    ...(recalled.historyDraft === undefined ? {} : { historyDraft: recalled.historyDraft }),
    ...(recalled.historyQuery === undefined ? {} : { historyQuery: recalled.historyQuery }),
  }
}

export { routeLine }
