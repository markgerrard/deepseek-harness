/**
 * Thin DSH service controller for the Crush-style TUI. Owns agent create /
 * resume / switch, session listing, model selection, slash dispatch, and
 * approval / ask-user answerers. Presentation state stays in `state.ts`.
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
import { createUserMessage } from '@deepseek-ai/dsh-llm'
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
import { chromeAction, initialState, reduce, type ModelRow, type Overlay, type SessionRow, type TuiAction, type TuiState } from './state.ts'
import { foldRequestModel, foldSessionTitle, projectTranscript, type TranscriptItem } from './transcript.ts'

const API_KEY_REF = credentialRef('DEEPSEEK_API_KEY')

/** Listener notified after every state change. */
export type StateListener = (state: TuiState) => void

/** Process-facing effects the runner substitutes in tests. */
export interface ControllerIo {
  /** Request process exit after the tree disposes. */
  exit(code: number): void
}

/**
 * Crush-style TUI controller over official DSH services.
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
   * Current Crush UI snapshot.
   * @returns a snapshot of the Crush UI state.
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
   * Project the live session log into Crush transcript rows.
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
   * Home directory used to collapse sidebar paths.
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
   * @param key - Ink key name.
   * @returns true when the key was consumed.
   */
  async handleKey(key: string): Promise<boolean> {
    const chrome = chromeAction(this.state, key)
    if (chrome !== undefined) {
      this.dispatch(chrome)
      return true
    }
    if (key === 'ctrl+n') {
      await this.create()
      return true
    }
    if (key === 'ctrl+c') {
      this.io.exit(0)
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
   * Confirm the active Crush overlay.
   */
  async confirmOverlay(): Promise<void> {
    const overlay = this.state.overlay
    switch (overlay.kind) {
      case 'none':
      case 'help':
        this.dispatch({ type: 'close-overlay' })
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
   * Refresh session list, model catalog, and token occupancy.
   */
  async refreshCatalogs(): Promise<void> {
    const sessions = await this.listSessions()
    this.dispatch({ type: 'set-sessions', sessions })
    const models = await this.listModels()
    this.dispatch({ type: 'set-models', models })
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
    this.dispatch({ type: 'set-tokens', usedTokens: measurement.totalTokens, contextWindow: this.state.contextWindow })
  }

  /**
   * First-run guidance when the DeepSeek credential is unconfigured.
   * @param ctx - plugin context carrying optional credentials.
   * @returns guidance text, or undefined when a key is present.
   */
  static async guidance(ctx: Context): Promise<string | undefined> {
    const credentials = ctx.get('credentials')
    if (credentials === undefined) return undefined
    const info = await credentials.describe(API_KEY_REF)
    if (info.configured) return undefined
    return 'No DEEPSEEK_API_KEY is configured. The TUI uses the harness credential store — it does not create one.'
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
    this.eventDisposer = this.ctx.on('session/event', (session: Session, event: SessionEvent) => {
      if (session.id !== agent.id) return
      this.events = [...session.events]
      const title = foldSessionTitle(this.events)
      if (title !== undefined) this.dispatch({ type: 'set-session', sessionId: agent.id, title })
      this.dispatch({ type: 'set-busy', busy: agent.status === 'running' })
      this.refreshTokens()
      void event
    }) as unknown as () => void
    this.dispatch({ type: 'set-busy', busy: agent.status === 'running' })
  }

  private async disposeHandle(): Promise<void> {
    this.eventDisposer?.()
    this.eventDisposer = undefined
    const existing = this.handle
    this.handle = undefined
    this.events = []
    if (existing === undefined) return
    existing.agent.cancel({ kind: 'user' })
    await existing.dispose()
  }

  private listCommands(): CommandDescriptor[] {
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
        this.io.exit(0)
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

  private async listSessions(): Promise<SessionRow[]> {
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) return []
    const headers = await persistence.list()
    const rows: SessionRow[] = []
    for (const header of headers) {
      if (header.origin === 'subagent') continue
      let title = header.id
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
    return rows
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
}
