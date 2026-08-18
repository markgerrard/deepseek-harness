/**
 * Thin DSH service controller for the Claude Code-like TUI. Owns agent create /
 * resume / switch, session listing, model selection, slash dispatch,
 * `/connect` credential writes, and approval / ask-user answerers.
 * Presentation state stays in `state.ts`.
 * @module @deepseek-ai/dsh-tui/controller
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type { CommandDescriptor } from '@deepseek-ai/dsh-commands'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-token-meter'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import { CHROME_COMMANDS, filterPalette, mergePalette, routeLine } from './commands.ts'
import {
  CONNECT_PROVIDERS,
  MISSING_KEY_GUIDANCE,
  connectProviderById,
  credentialRefsFor,
  sortModelRows,
  type ConnectProviderRow,
} from './connect.ts'
import {
  chromeAction,
  initialState,
  reduce,
  resolveQuitKey,
  type ModelRow,
  type Overlay,
  type SessionRow,
  type TuiAction,
  type TuiState,
} from './state.ts'
import {
  capSuggestion,
  conversationSnippet,
  fallbackSuggestion,
  readSuggestionText,
  shouldApplySuggestion,
  suggestionGenerateOptions,
  SUGGESTION_TIMEOUT_MS,
} from './suggestion.ts'
import { foldRequestModel, foldSessionTitle, projectTranscript, type TranscriptItem } from './transcript.ts'

/**
 * Reject when `signal` is (or becomes) aborted so a hung `llm.stream` cannot
 * stall {@link TuiController.consumeSuggestion}.
 */
function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = (): void => {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    }
    if (signal.aborted) {
      fail()
      return
    }
    signal.addEventListener('abort', fail, { once: true })
  })
}

/** Last assistant card id in a projected transcript, if any. */
function lastAssistantId(items: readonly TranscriptItem[]): string | undefined {
  let id: string | undefined
  for (const item of items) {
    if (item.kind === 'assistant') id = item.id
  }
  return id
}

/** Listener notified after every state change. */
export type StateListener = (state: TuiState) => void

/** Process-facing effects the runner substitutes in tests. */
export interface ControllerIo {
  /** Request process exit after the tree disposes. */
  exit(code: number): void
}

/**
 * Claude Code-like TUI controller over official DSH services.
 */
export class TuiController {
  private state: TuiState
  private readonly listeners = new Set<StateListener>()
  private handle: AgentHandle | undefined
  private selection: ModelSelectionRef
  private events: SessionEvent[] = []
  private eventDisposer: (() => void) | undefined
  private answerersInstalled = false
  private approvalWaiter: ((outcome: ApprovalOutcome) => void) | undefined
  private questionWaiter: ((answer: AskUserQuestionAnswer) => void) | undefined
  private pendingQuestionIds: string[] = []
  private suggestionEpoch = 0
  private suggestionAbort: AbortController | undefined
  /** Last assistant card we already showed a ghost for; submit/type must not replay it. */
  private suggestedAssistantId: string | undefined

  /**
   * @param ctx - settled plugin context carrying core DSH services.
   * @param io - launcher exit hook.
   * @param seed - initial UI facts.
   */
  constructor(
    private readonly ctx: Context,
    private readonly io: ControllerIo,
    seed: { width: number; height: number; cwd: string; provider: string; model: string; guidance?: string },
  ) {
    this.selection = { current: { provider: seed.provider, model: seed.model }, assembled: undefined }
    this.state = initialState(seed)
  }

  /**
   * Current UI snapshot.
   * @returns a snapshot of the UI state.
   */
  snapshot(): TuiState {
    return this.state
  }

  /**
   * Subscribe to state changes.
   * @param listener - called after every dispatch.
   * @returns disposer.
   */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Project the live session log into transcript rows.
   * @returns transcript items for the current expansion sets.
   */
  transcript(): TranscriptItem[] {
    return projectTranscript(this.events, this.state.expansion)
  }

  /**
   * Command palette rows (chrome + DSH-registered).
   * @returns filtered palette items.
   */
  palette(): ReturnType<typeof filterPalette> {
    const registered = this.listCommands()
    const query = this.state.overlay.kind === 'commands' ? this.state.overlay.query : this.state.input
    return filterPalette(mergePalette(registered), query)
  }

  /**
   * Home directory used to collapse cwd paths.
   * @returns `$HOME`, when available.
   */
  home(): string | undefined {
    try {
      return homedir()
    } catch {
      return undefined
    }
  }

  /**
   * Dispatch a pure UI action.
   * @param action - UI action.
   */
  dispatch(action: TuiAction): void {
    if (this.invalidatesSuggestion(action)) this.cancelSuggestionRequest()
    this.state = reduce(this.state, action)
    const paletteLength = this.palette().length
    if (this.state.paletteLength !== paletteLength) {
      this.state = reduce(this.state, { type: 'set-palette-length', paletteLength })
    }
    if (this.state.overlay.kind === 'commands') {
      const selected = this.state.overlay.selected
      const clamped = selected >= paletteLength ? Math.max(0, paletteLength - 1) : selected
      if (clamped !== selected) {
        this.state = { ...this.state, overlay: { ...this.state.overlay, selected: clamped } }
      }
    }
    for (const listener of this.listeners) listener(this.state)
  }

  /**
   * Mount answerers, list sessions/models, and open or resume a session.
   * @param resumeId - optional `--resume` session id.
   */
  async start(resumeId?: string): Promise<void> {
    this.installAnswerers()
    await this.refreshCatalogs()
    if (resumeId !== undefined) {
      await this.resume(resumeId)
      return
    }
    await this.create()
  }

  /**
   * Create a fresh persisted Agent.
   */
  async create(): Promise<void> {
    this.suggestedAssistantId = undefined
    this.dispatch({ type: 'set-suggestion' })
    await this.disposeHandle()
    const selection = this.currentSelection()
    this.selection = { current: selection, assembled: undefined }
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(`session-${randomUUID()}`),
      meta: { cwd: this.state.cwd },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: (agentCtx) => { installModelSelection(agentCtx, this.selection) },
    })
    this.attach(handle)
    this.dispatch({ type: 'set-session', sessionId: handle.agent.id })
    this.dispatch({ type: 'set-screen', screen: this.state.guidance === undefined ? 'landing' : 'onboarding' })
  }

  /**
   * Resume a persisted session through `ctx.agents.resume`.
   * @param id - stored session id.
   */
  async resume(id: string): Promise<void> {
    this.suggestedAssistantId = undefined
    this.dispatch({ type: 'set-suggestion' })
    await this.disposeHandle()
    const selection = this.currentSelection()
    this.selection = { current: selection, assembled: undefined }
    const handle = await this.ctx.agents.resume({
      resumeSessionId: SessionId(id),
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: (agentCtx) => { installModelSelection(agentCtx, this.selection) },
    })
    this.attach(handle)
    const title = foldSessionTitle(this.events)
    this.dispatch({ type: 'set-session', sessionId: handle.agent.id, ...(title === undefined ? {} : { title }) })
    this.dispatch({ type: 'set-screen', screen: 'chat' })
  }

  /**
   * Handle an Ink key. Chrome keys update state; enter sends; esc cancels.
   * First ctrl+c opens the quit dialog; a second ctrl+c quits.
   * @param key - Ink key name.
   * @returns true when the key was consumed.
   */
  async handleKey(key: string): Promise<boolean> {
    const selectedNope = this.state.overlay.kind === 'quit' ? this.state.overlay.selectedNope : true
    const quit = resolveQuitKey(this.state.overlay.kind, selectedNope, key)
    switch (quit.type) {
      case 'open':
        this.dispatch({ type: 'open-overlay', overlay: { kind: 'quit', selectedNope: true } })
        return true
      case 'exit':
        this.io.exit(0)
        return true
      case 'dismiss':
        this.dispatch({ type: 'close-overlay' })
        return true
      case 'toggle':
        this.dispatch({ type: 'toggle-quit' })
        return true
      case 'ignore':
        break
      default: {
        const _exhaustive: never = quit
        return _exhaustive
      }
    }
    const chrome = chromeAction(this.state, key)
    if (chrome !== undefined) {
      this.dispatch(chrome)
      return true
    }
    if (key === 'ctrl+n') {
      await this.create()
      return true
    }
    if (key === 'escape' || key === 'esc') {
      if (this.state.busy) {
        this.agent()?.cancel({ kind: 'user' })
        return true
      }
    }
    if ((key === 'return' || key === 'enter') && this.state.overlay.kind !== 'none') {
      await this.confirmOverlay()
      return true
    }
    return false
  }

  /**
   * Submit the editor line as a prompt or slash command.
   * @param line - exact editor contents.
   */
  async submit(line: string): Promise<void> {
    const routed = routeLine(line)
    this.dispatch({ type: 'clear-input' })
    if (routed.kind === 'empty') return
    if (routed.kind === 'command') {
      await this.runCommand(routed.line, routed.name, routed.rawInput)
      return
    }
    const agent = this.agent()
    if (agent === undefined) return
    if (this.state.screen !== 'chat') this.dispatch({ type: 'set-screen', screen: 'chat' })
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: routed.text }],
      source: { kind: 'user' },
    }))
  }

  /**
   * Apply a mid-session model switch through the mutable selection ref.
   * @param provider - registered provider route.
   * @param model - provider model id.
   */
  switchModel(provider: string, model: string): void {
    this.selection.current = { provider, model }
    this.ctx.agentDefaultModel?.saveSelection({ provider, model })
    this.dispatch({ type: 'set-model', provider, model })
  }

  /**
   * Confirm the active overlay.
   */
  async confirmOverlay(): Promise<void> {
    const overlay = this.state.overlay
    switch (overlay.kind) {
      case 'none':
      case 'help':
        this.dispatch({ type: 'close-overlay' })
        return
      case 'quit':
        if (overlay.selectedNope) this.dispatch({ type: 'close-overlay' })
        else this.io.exit(0)
        return
      case 'commands': {
        const items = this.palette()
        const item = items[overlay.selected]
        this.dispatch({ type: 'close-overlay' })
        if (item !== undefined) await this.submit(item.line)
        return
      }
      case 'models': {
        const row = this.state.models[overlay.selected]
        this.dispatch({ type: 'close-overlay' })
        if (row !== undefined) this.switchModel(row.provider, row.id)
        return
      }
      case 'sessions': {
        const row = this.state.sessions[overlay.selected]
        this.dispatch({ type: 'close-overlay' })
        if (row !== undefined) await this.resume(row.id)
        return
      }
      case 'connect-provider': {
        const row = this.state.connectProviders[overlay.selected]
        if (row === undefined) {
          this.dispatch({ type: 'close-overlay' })
          return
        }
        this.dispatch({
          type: 'open-overlay',
          overlay: { kind: 'connect-key', providerId: row.id, value: '' },
        })
        return
      }
      case 'connect-key':
        await this.saveConnectKey(overlay.providerId, overlay.value)
        return
      case 'approval': {
        const outcome: ApprovalOutcome = overlay.selected === 0 ? 'allowed-once' : 'rejected'
        this.approvalWaiter?.(outcome)
        this.approvalWaiter = undefined
        this.dispatch({ type: 'close-overlay' })
        return
      }
      case 'question': {
        const selected = overlay.multi
          ? overlay.chosen
          : [overlay.selected]
        const labels = selected
          .map(index => overlay.options[index])
          .filter((label): label is string => label !== undefined)
        this.questionWaiter?.({
          answers: this.pendingQuestionIds.map(id => ({ id, selected: labels })),
        })
        this.questionWaiter = undefined
        this.pendingQuestionIds = []
        this.dispatch({ type: 'close-overlay' })
        return
      }
      default: {
        const _exhaustive: never = overlay
        return _exhaustive
      }
    }
  }

  /**
   * Refresh session list, model catalog, connect rows, and token occupancy.
   */
  async refreshCatalogs(): Promise<void> {
    const sessions = await this.listSessions()
    this.dispatch({ type: 'set-sessions', sessions })
    const models = await this.listModels()
    this.dispatch({ type: 'set-models', models })
    const connectProviders = await this.listConnectProviders()
    this.dispatch({ type: 'set-connect-providers', connectProviders })
    this.refreshTokens()
  }

  /**
   * Re-read token occupancy from `ctx.tokenMeter` when present.
   */
  refreshTokens(): void {
    const agent = this.agent()
    const meter = this.ctx.get('tokenMeter')
    if (agent === undefined || meter === undefined) return
    const measurement = meter.measure(agent.session)
    this.dispatch({
      type: 'set-tokens',
      usedTokens: measurement.totalTokens,
      ...(this.state.contextWindow === undefined ? {} : { contextWindow: this.state.contextWindow }),
    })
  }

  /**
   * First-run guidance when no connectable provider has a configured key.
   * @param ctx - plugin context carrying optional credentials.
   * @returns guidance text, or undefined when any key is present.
   */
  static async guidance(ctx: Context): Promise<string | undefined> {
    const credentials = ctx.get('credentials')
    if (credentials === undefined) return undefined
    for (const provider of CONNECT_PROVIDERS) {
      for (const name of credentialRefsFor(provider)) {
        const info = await credentials.describe(credentialRef(name))
        if (info.configured) return undefined
      }
    }
    return MISSING_KEY_GUIDANCE
  }

  private agent(): Agent | undefined {
    return this.handle?.agent
  }

  private currentSelection(): { provider: string; model: string } {
    const current = this.ctx.agentDefaultModel?.currentSelection()
    return {
      provider: current?.provider ?? this.state.provider,
      model: current?.model ?? this.state.model,
    }
  }

  private attach(handle: AgentHandle): void {
    this.handle = handle
    const agent = handle.agent
    this.events = [...agent.session.events]
    const model = foldRequestModel(this.events)
    if (model !== undefined) this.dispatch({ type: 'set-model', provider: model.provider, model: model.model })
    this.eventDisposer?.()
    const offSession = this.ctx.on('session/event', (session: Session, event: SessionEvent) => {
      if (session.id !== agent.id) return
      this.events = [...session.events]
      const title = foldSessionTitle(this.events)
      if (title !== undefined) this.dispatch({ type: 'set-session', sessionId: agent.id, title })
      // Session events can land while the driver is still running (committed
      // assistant text). Busy follows agent/status, not the last log row.
      this.dispatch({ type: 'set-busy', busy: agent.status === 'running' })
      this.refreshTokens()
      // Idle can land before the last assistant is projected. Retry once the
      // transcript has a user+assistant pair and no request is in flight.
      if (agent.status !== 'running') this.maybeRequestSuggestion()
      void event
    }) as unknown as () => void
    const offStatus = this.ctx.on('agent/status', ({ agent: next, status }) => {
      if (next.id !== agent.id) return
      this.dispatch({ type: 'set-busy', busy: status === 'running' })
      if (status !== 'running') {
        this.refreshTokens()
        this.maybeRequestSuggestion()
      }
    }) as unknown as () => void
    this.eventDisposer = () => {
      offSession()
      offStatus()
    }
    this.dispatch({ type: 'set-busy', busy: agent.status === 'running' })
  }

  private async disposeHandle(): Promise<void> {
    this.suggestedAssistantId = undefined
    this.cancelSuggestionRequest()
    this.eventDisposer?.()
    this.eventDisposer = undefined
    const existing = this.handle
    this.handle = undefined
    this.events = []
    if (existing === undefined) return
    existing.agent.cancel({ kind: 'user' })
    await existing.dispose()
  }

  private listCommands(): readonly CommandDescriptor[] {
    const commands = this.ctx.get('commands')
    const agent = this.agent()
    if (commands === undefined || agent === undefined) return []
    return commands.list(agent)
  }

  private async runCommand(line: string, name: string, _rawInput: string): Promise<void> {
    switch (name) {
      case 'help':
        this.dispatch({ type: 'open-overlay', overlay: { kind: 'help' } })
        return
      case 'connect':
        await this.refreshCatalogs()
        this.dispatch({ type: 'open-overlay', overlay: { kind: 'connect-provider', selected: 0 } })
        return
      case 'model':
        this.dispatch({ type: 'open-overlay', overlay: { kind: 'models', selected: 0 } })
        return
      case 'sessions':
        await this.refreshCatalogs()
        this.dispatch({ type: 'open-overlay', overlay: { kind: 'sessions', selected: 0 } })
        return
      case 'new':
        await this.create()
        return
      case 'interrupt':
        this.agent()?.cancel({ kind: 'user' })
        return
      case 'quit':
        this.dispatch({ type: 'open-overlay', overlay: { kind: 'quit', selectedNope: true } })
        return
      default:
        break
    }
    const commands = this.ctx.get('commands')
    const agent = this.agent()
    if (commands === undefined || agent === undefined) return
    const execution = await commands.execute(agent, line, new AbortController().signal)
    if (execution === undefined) {
      this.dispatch({ type: 'open-overlay', overlay: { kind: 'help' } })
    }
    void CHROME_COMMANDS
  }

  /**
   * Store a pasted key through `ctx.credentials.set`. Never logs the value.
   * @param providerId - connectable provider route.
   * @param value - typed key.
   */
  private async saveConnectKey(providerId: string, value: string): Promise<void> {
    const provider = connectProviderById(providerId)
    if (provider === undefined) {
      this.dispatch({ type: 'close-overlay' })
      return
    }
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) {
      this.dispatch({ type: 'set-connect-error', error: 'No credentials service is mounted.' })
      return
    }
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      this.dispatch({ type: 'set-connect-error', error: 'Paste a non-empty API key.' })
      return
    }
    const ref = credentialRef(provider.apiKeyEnv)
    const info = await credentials.describe(ref)
    if (!info.writable) {
      this.dispatch({
        type: 'set-connect-error',
        error: `${provider.apiKeyEnv} is set in the environment and is not writable from the TUI. Unset it in the shell you start dsh from.`,
      })
      return
    }
    try {
      await credentials.set(ref, trimmed)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not store the key.'
      this.dispatch({ type: 'set-connect-error', error: message })
      return
    }
    this.dispatch({ type: 'close-overlay' })
    this.dispatch({ type: 'set-notice', notice: { type: 'success', text: `${provider.displayName} key saved.` } })
    const guidance = await TuiController.guidance(this.ctx)
    this.dispatch({ type: 'set-guidance', ...(guidance === undefined ? {} : { guidance }) })
    await this.refreshCatalogs()
  }

  private async listConnectProviders(): Promise<ConnectProviderRow[]> {
    const credentials = this.ctx.get('credentials')
    const rows: ConnectProviderRow[] = []
    for (const provider of CONNECT_PROVIDERS) {
      let configured = false
      let writable = true
      if (credentials !== undefined) {
        const primary = await credentials.describe(credentialRef(provider.apiKeyEnv))
        writable = primary.writable
        configured = primary.configured
        if (!configured) {
          for (const alias of provider.apiKeyEnvAliases ?? []) {
            const info = await credentials.describe(credentialRef(alias))
            if (info.configured) {
              configured = true
              break
            }
          }
        }
      }
      rows.push({
        id: provider.id,
        displayName: provider.displayName,
        apiKeyEnv: provider.apiKeyEnv,
        configured,
        writable,
      })
    }
    return rows
  }

  private async listSessions(): Promise<SessionRow[]> {
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) return []
    const headers = await persistence.list()
    const rows: SessionRow[] = []
    for (const header of headers) {
      if (header.origin === 'subagent') continue
      let title: string = header.id
      try {
        const inspected = await persistence.inspect(header.id)
        title = foldSessionTitle(inspected.events) ?? header.id
      } catch {
        // Listing stays available when one log cannot be inspected.
      }
      rows.push({
        id: header.id,
        title,
        ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
        createdAt: header.createdAt,
      })
    }
    return rows.sort((left, right) => right.createdAt - left.createdAt)
  }

  private async listModels(): Promise<ModelRow[]> {
    const llm = this.ctx.get('llm')
    if (llm === undefined) return []
    const rows: ModelRow[] = []
    for (const provider of llm.listProviders()) {
      try {
        const models = await llm.listModels(provider.id)
        for (const model of models) {
          rows.push({ provider: provider.id, id: model.id, name: model.name })
        }
      } catch {
        rows.push({ provider: provider.id, id: this.state.model, name: this.state.model })
      }
    }
    if (rows.length === 0) {
      rows.push({ provider: this.state.provider, id: this.state.model, name: this.state.model })
    }
    return sortModelRows(rows)
  }

  private installAnswerers(): void {
    if (this.answerersInstalled) return
    this.answerersInstalled = true
    this.ctx.on('approval/request', async (req, next) => {
      const agent = this.agent()
      if (agent === undefined || req.agent.id !== agent.id) return next()
      const overlay: Overlay = {
        kind: 'approval',
        toolName: req.toolName,
        ...(req.reason === undefined ? {} : { reason: req.reason }),
        selected: 0,
      }
      this.dispatch({ type: 'open-overlay', overlay })
      return await new Promise<ApprovalOutcome>((resolve) => {
        this.approvalWaiter = resolve
        req.signal?.addEventListener('abort', () => {
          resolve('cancelled')
          this.approvalWaiter = undefined
          this.dispatch({ type: 'close-overlay' })
        }, { once: true })
      })
    })
    const questions = this.ctx.get('userQuestions')
    questions?.registerProvider({
      ask: async (request) => {
        const first = request.questions[0]
        if (first === undefined) return { answers: [] }
        this.pendingQuestionIds = request.questions.map(question => question.id)
        const options = first.options?.map(option => option.label) ?? ['OK']
        this.dispatch({
          type: 'open-overlay',
          overlay: {
            kind: 'question',
            prompt: first.question,
            options,
            selected: 0,
            multi: first.multiSelect === true,
            chosen: [],
          },
        })
        return await new Promise<AskUserQuestionAnswer>((resolve) => {
          this.questionWaiter = resolve
          request.signal?.addEventListener('abort', () => {
            resolve({ answers: this.pendingQuestionIds.map(id => ({ id, selected: [] })) })
            this.questionWaiter = undefined
            this.dispatch({ type: 'close-overlay' })
          }, { once: true })
        })
      },
    })
  }

  /**
   * Whether `action` should cancel an in-flight follow-up suggestion.
   * @param action - the UI action about to be reduced.
   * @returns true when typing, submit/clear, a new turn, or an explicit dismiss.
   */
  private invalidatesSuggestion(action: TuiAction): boolean {
    switch (action.type) {
      case 'set-input':
        return action.input !== ''
      case 'clear-input':
        return true
      case 'set-busy':
        return action.busy
      case 'set-suggestion':
        return action.suggestion === undefined || action.suggestion === ''
      default:
        return false
    }
  }

  /** Abort any in-flight suggestion request and bump the epoch so late results are ignored. */
  private cancelSuggestionRequest(): void {
    this.suggestionEpoch += 1
    this.suggestionAbort?.abort()
    this.suggestionAbort = undefined
  }

  /**
   * Copy the live session log so a suggestion request sees the latest cards.
   * `agent/status` idle can fire before `session/event` updates `this.events`.
   */
  private syncTranscriptEvents(): void {
    const agent = this.agent()
    if (agent !== undefined) this.events = [...agent.session.events]
  }

  /**
   * Start a follow-up suggestion when idle, the editor is empty, and nothing
   * is already in flight. Used from both `agent/status` idle and later
   * `session/event` (retry when the first idle saw an empty snippet).
   */
  private maybeRequestSuggestion(): void {
    if (this.state.busy) return
    if (this.state.input !== '') return
    if (this.state.suggestion !== undefined && this.state.suggestion !== '') return
    if (this.suggestionAbort !== undefined) return
    this.requestSuggestion()
  }

  /**
   * Show a last-assistant fallback immediately, then fire one detached
   * follow-up completion that may upgrade the ghost. Empty transcripts keep
   * `Ask DSH…`. A missing, empty, hung, or failing LLM leaves the fallback.
   */
  private requestSuggestion(): void {
    this.cancelSuggestionRequest()
    const epoch = this.suggestionEpoch
    this.syncTranscriptEvents()
    const items = this.transcript()
    const assistantId = lastAssistantId(items)
    // Submit/type/escape clear the ghost; do not replay the same completed turn.
    if (assistantId !== undefined && assistantId === this.suggestedAssistantId) return
    this.applyFallbackSuggestion(epoch, items)
    if (assistantId !== undefined) this.suggestedAssistantId = assistantId
    const snippet = conversationSnippet(items)
    if (snippet === '') return
    const abort = new AbortController()
    this.suggestionAbort = abort
    const options = suggestionGenerateOptions(
      { provider: this.state.provider, model: this.state.model },
      snippet,
      abort.signal,
    )
    void this.consumeSuggestion(options, epoch, items, abort)
  }

  /**
   * Read a detached stream and upgrade the ghost when the request is still current.
   * Empty or junk text keeps the fallback already shown. The stream is aborted
   * after {@link SUGGESTION_TIMEOUT_MS} so a hang cannot block forever.
   * @param options - `ctx.llm.stream` generate options.
   * @param epoch - epoch captured when the request started.
   * @param items - transcript snapshot used for a local fallback.
   * @param abort - controller for this request; cleared when it settles.
   */
  private async consumeSuggestion(
    options: GenerateOptions,
    epoch: number,
    items: TranscriptItem[],
    abort: AbortController,
  ): Promise<void> {
    const timer = setTimeout(() => abort.abort(), SUGGESTION_TIMEOUT_MS)
    try {
      const llm = this.ctx.get('llm')
      if (llm === undefined) {
        this.applyFallbackSuggestion(epoch, items)
        return
      }
      const text = await Promise.race([
        readSuggestionText(llm.stream(options)),
        whenAborted(abort.signal),
      ])
      const suggestion = capSuggestion(text)
      if (suggestion === undefined) {
        this.applyFallbackSuggestion(epoch, items)
        return
      }
      if (!shouldApplySuggestion(this.state, epoch, this.suggestionEpoch)) return
      this.dispatch({ type: 'set-suggestion', suggestion })
    } catch {
      this.applyFallbackSuggestion(epoch, items)
    } finally {
      clearTimeout(timer)
      if (this.suggestionAbort === abort) this.suggestionAbort = undefined
    }
  }

  /**
   * Commit a last-assistant phrase when a detached LLM call cannot run.
   * @param epoch - epoch captured when the request started.
   * @param items - transcript snapshot.
   */
  private applyFallbackSuggestion(epoch: number, items: readonly TranscriptItem[]): void {
    if (!shouldApplySuggestion(this.state, epoch, this.suggestionEpoch)) return
    const suggestion = fallbackSuggestion(items)
    if (suggestion === undefined) return
    this.dispatch({ type: 'set-suggestion', suggestion })
  }
}
