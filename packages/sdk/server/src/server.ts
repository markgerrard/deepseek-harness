/**
 * JSON-RPC methods and notifications for out-of-process harness SDKs.
 * The surrounding context owns plugins, persistence, and configured adapters.
 *
 * @module @deepseek-ai/dsh-sdk-jsonrpc-server/server
 */

import type { Context } from '@deepseek-ai/cordis'
import { resolve } from 'node:path'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { carrierKeyOf, type Scoped } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import type SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentRunEndInfo } from '@deepseek-ai/dsh-subagent'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import type {
  InitializeParams,
  InitializeResult,
  JsonRpcTransportPeer,
  SdkPermissionOutcome,
  SessionCancelParams,
  SessionEventNotification,
  SessionPromptParams,
  SessionPromptResult,
  SessionResumeParams,
  SubagentFinishedNotification,
  SubagentStartedNotification,
} from '@deepseek-ai/dsh-sdk-protocol'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'

const PERMISSION_OUTCOMES: readonly SdkPermissionOutcome[] = [
  'allowed-once', 'rejected', 'cancelled', 'unavailable',
]

/** Map a wire result to a closed outcome. Unknown values never grant. */
function permissionOutcome(result: unknown): ApprovalOutcome {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) return 'rejected'
  const outcome = (result as { outcome?: unknown }).outcome
  return typeof outcome === 'string' && PERMISSION_OUTCOMES.includes(outcome as SdkPermissionOutcome)
    ? outcome as ApprovalOutcome
    : 'rejected'
}

/** `approvals: true` only — any other wire value is treated as absent. */
function clientAdvertisesApprovals(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (value as { approvals?: unknown }).approvals === true
}

interface SessionRecord {
  handle: AgentHandle
  /**
   * A cancel that arrived while the load producing this record was in flight
   * and that the waiting `session/prompt` has not applied yet. Applying it
   * before that prompt enqueues would leave the queued message running,
   * because `agent.cancel` does not arm later work.
   */
  pendingCancel: boolean
}

type SessionLoadKind = 'create' | 'resume'

interface PendingSessionLoad {
  kind: SessionLoadKind
  task: Promise<SessionRecord>
  /** A `session/cancel` arrived while this load was in flight. */
  cancelled: boolean
  /**
   * A `session/prompt` is waiting on this load and enqueues once it settles.
   * The cancel then belongs to that prompt's settlement rather than the
   * load's: it must land after the enqueue. A load with no waiting prompt
   * carries the cancel to completion itself.
   */
  promptWaiting: boolean
}

/** Recover the delegating parent from the service-owned scoped carrier. */
function subagentParentOf(carrier: Scoped<SubagentRuntime>): Agent {
  return carrierKeyOf(carrier) as Agent
}

/** Deployment-specific status mapping for SDK turn and subagent outcomes. */
export interface HarnessSdkJsonRpcServerOptions {
  /** Report max-token termination as an accepted result instead of an infrastructure error. */
  maxTokensAsSuccess?: boolean
  /**
   * Bound, in milliseconds, for one relayed `session/request_permission`.
   * Expiry aborts the outbound RPC and the ask settles `'unavailable'`.
   * Omitted: wait only on {@link ApprovalRequest.signal}; an ask with
   * neither signal nor bound is delegated instead of waited on.
   */
  approvalRequestTimeoutMs?: number
}

function successStatus(reason: string, options: HarnessSdkJsonRpcServerOptions): 'ok' | 'error' {
  if (reason === 'completed') return 'ok'
  return reason === 'max-tokens' && options.maxTokensAsSuccess === true ? 'ok' : 'error'
}

/**
 * SDK server over one booted harness context and transport peer. Construction
 * subscribes to session, agent, and subagent lifecycle events until shutdown;
 * reinitialization is unsupported.
 */
export class HarnessSdkJsonRpcServer {
  private cwd = process.cwd()
  private provider = 'deepseek-official'
  private model = 'deepseek-official'
  private maxTokens: number | undefined
  private llmFiber: { dispose(): Promise<void> } | undefined
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly sessionCreations = new Map<string, PendingSessionLoad>()
  private readonly disposers: (() => void)[] = []
  private shutdownTask: Promise<Record<string, never>> | undefined
  private shuttingDown = false
  private clientApprovals = false

  constructor(
    private readonly ctx: Context,
    private readonly transport: JsonRpcTransportPeer,
    private readonly options: HarnessSdkJsonRpcServerOptions = {},
  ) {
    const serverOptions = this.options
    this.disposers.push(ctx.on('session/event', (session, event) => {
      const payload: SessionEventNotification = { sessionId: String(session.id), event }
      this.transport.notify('session.event', payload)
    }))
    this.disposers.push(ctx.on('agent/status', ({ agent, status }) => {
      this.transport.notify('session.status', { sessionId: String(agent.session.id), status })
    }))
    this.disposers.push(ctx.on('session/created', (session) => {
      const parentSession = session.header.parentSession
      if (parentSession === undefined) return
      const payload: SubagentStartedNotification = {
        parentSessionId: String(parentSession),
        childSessionId: String(session.id),
      }
      this.transport.notify('subagent.started', payload)
    }))
    this.disposers.push(ctx.on('subagent/end', function (this: Scoped<SubagentRuntime>, info: SubagentRunEndInfo) {
      const parent = subagentParentOf(this)
      // This protocol reports only in-process child sessions. The service
      // snapshots the provider name and local flag through child disposal;
      // matching ids or parent lineage alone never establishes locality.
      if (!info.local) return
      const payload: SubagentFinishedNotification = {
        provider: info.provider,
        agentId: String(info.id),
        parentSessionId: String(parent.session.id),
        childSessionId: String(info.id),
        status: successStatus(info.stopReason, serverOptions),
        stopReason: info.stopReason,
        ...(info.lastAssistantMessage === undefined ? {} : { lastAssistantMessage: info.lastAssistantMessage }),
      }
      transport.notify('subagent.finished', payload)
    }))
    // Relays only after initialize sees `clientCapabilities.approvals === true`.
    // A client that omitted the field must observe today's fail-closed path:
    // this listener calls next() and never writes a server-to-client request.
    this.disposers.push(ctx.on('approval/request', (request, next) => {
      if (!this.clientApprovals) return next()
      const rec = this.sessions.get(String(request.agent.session.id))
      if (rec === undefined || rec.handle.agent !== request.agent) return next()
      // An advertising client that never answers has no other bound when the
      // asker omitted `signal` and the deployment set no timeout.
      if (request.signal === undefined && this.options.approvalRequestTimeoutMs === undefined) return next()
      return this.relayApproval(request)
    }))
  }

  /**
   * Configure the SDK route, mounting the DeepSeek fallback only when unowned.
   * `clientCapabilities.approvals === true` is the only advertisement that
   * enables `session/request_permission`.
   * @param params - SDK handshake parameters.
   * @returns server identity for the handshake.
   */
  async initialize(params: InitializeParams): Promise<InitializeResult> {
    if (params.maxTokens !== undefined
      && (!Number.isSafeInteger(params.maxTokens) || params.maxTokens <= 0)) {
      throw new TypeError('initialize maxTokens must be a positive safe integer')
    }
    this.cwd = resolve(params.cwd)
    this.provider = params.provider
    this.model = params.model
    this.maxTokens = params.maxTokens
    this.clientApprovals = clientAdvertisesApprovals(params.clientCapabilities)
    if (!this.hasAdapterFor(this.provider)) {
      if (this.provider !== 'deepseek-official') throw new Error(`no adapter registered for provider "${this.provider}"`)
      this.llmFiber = await this.ctx.plugin(LlmDeepSeek, {})
    }
    return { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } }
  }

  /**
   * Queue one identified prompt without assigning later activity to it.
   * @param params - target session and user content.
   * @returns the durable message identity.
   */
  async prompt(params: SessionPromptParams): Promise<SessionPromptResult> {
    const rec = await this.getOrCreateSession(params.sessionId)
    try {
      // An agent-loop-only reload disposes the loop's agents while this record
      // survives; a retained agent accepts followup() silently, so validate the
      // record against the live registry before delivery (as the ACP bridge does).
      if (this.ctx.agents.get(rec.handle.agent.id) !== rec.handle.agent) {
        throw new Error(`session agent was disposed outside the server: ${params.sessionId}`)
      }
      const message = createUserMessage({ content: params.contentBlocks, source: { kind: 'user' } })
      rec.handle.agent.followup(message)
      return { messageId: message.id }
    } finally {
      this.applyPendingCancel(rec)
    }
  }

  /**
   * Abort the addressed session's in-flight turn and queued inbox work.
   * Unknown session ids are a no-op so a late cancel after teardown cannot
   * fail the client. An in-flight lazy create or resume is not unknown:
   * cancel waits for that load and aborts the resulting agent. A cancel
   * that arrives before the first `followup` is remembered and applied
   * after enqueue — `agent.cancel` does not arm later work. There is no
   * pending `session/prompt` RPC to settle: that method already returned
   * its enqueue receipt.
   * @param params - the session to cancel.
   * @returns empty JSON-RPC result.
   */
  cancel(params: SessionCancelParams): Promise<Record<string, never>> {
    const rec = this.sessions.get(params.sessionId)
    if (rec !== undefined) {
      rec.handle.agent.cancel({ kind: 'user' })
      return Promise.resolve({})
    }
    const pending = this.sessionCreations.get(params.sessionId)
    if (pending === undefined) return Promise.resolve({})
    pending.cancelled = true
    return pending.task.then(
      (loaded) => {
        if (!pending.promptWaiting) this.applyPendingCancel(loaded)
        return {}
      },
      // A failed load hands the cancel to whatever continues the operation:
      // the lazy create a waiting prompt starts inherits it, and a load that
      // nothing continues drops it with its record.
      () => ({}),
    )
  }

  /**
   * Rehydrate a persisted session through `ctx.agents.resume()`. An already-live
   * id succeeds without reloading. An in-flight lazy create for the same id
   * rejects rather than reporting rehydration of that fresh session. A
   * concurrent prompt waits out this resume and still lazily creates if it
   * fails. This never creates a fresh session: a missing persistence backend,
   * missing log, corrupt log, or log written by a newer harness rejects with
   * that backend's message. Compression mismatches stay the persistence
   * backend's refusal.
   * @param params - the persisted session id.
   * @returns empty JSON-RPC result.
   */
  async resume(params: SessionResumeParams): Promise<Record<string, never>> {
    await this.getOrResumeSession(params.sessionId)
    return {}
  }

  /**
   * Dispose server-owned agents, adapter, and subscriptions to quiescence.
   * The surrounding context remains running.
   * @returns empty JSON-RPC result.
   */
  shutdown(): Promise<Record<string, never>> {
    this.shutdownTask ??= this.performShutdown()
    return this.shutdownTask
  }

  private async performShutdown(): Promise<Record<string, never>> {
    this.shuttingDown = true
    const pendingCreations = [...this.sessionCreations.values()].map(pending => pending.task)
    await Promise.allSettled(pendingCreations)
    this.sessionCreations.clear()
    const records = [...this.sessions.values()]
    this.sessions.clear()
    const failures: unknown[] = []
    while (this.disposers.length > 0) {
      try {
        this.disposers.pop()?.()
      } catch (error) {
        failures.push(error)
      }
    }
    const teardownResults = await Promise.allSettled([
      ...records.map(rec => Promise.resolve().then(() => rec.handle.dispose())),
      ...(this.llmFiber === undefined ? [] : [Promise.resolve().then(() => this.llmFiber?.dispose())]),
    ])
    this.llmFiber = undefined
    failures.push(...teardownResults
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason as unknown))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'SDK server teardown failed')
    return {}
  }

  /**
   * Dispatch one incoming JSON-RPC request to its typed handler. Throws (→ a
   * JSON-RPC error response) on an unknown method.
   * @param method - the JSON-RPC method name.
   * @param params - the raw params object from the wire.
   * @returns the handler's result, to be serialized as the response.
   */
  async handleRequest(method: string, params: Record<string, unknown> | undefined): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return this.initialize(params as unknown as InitializeParams)
      case 'session/prompt':
        return this.prompt(params as unknown as SessionPromptParams)
      case 'session/cancel':
        return this.cancel(params as unknown as SessionCancelParams)
      case 'session/resume':
        return this.resume(params as unknown as SessionResumeParams)
      case 'shutdown':
        return this.shutdown()
      default:
        throw new Error(`unknown DeepSeek Harness SDK runtime method: ${method}`)
    }
  }

  /** Apply a load's cancel to its session exactly once. */
  private applyPendingCancel(rec: SessionRecord): void {
    if (!rec.pendingCancel) return
    rec.pendingCancel = false
    rec.handle.agent.cancel({ kind: 'user' })
  }

  private getOrCreateSession(sessionId: string): Promise<SessionRecord> {
    return this.beginSessionLoad(sessionId, 'create', () => this.createSession(sessionId))
  }

  private getOrResumeSession(sessionId: string): Promise<SessionRecord> {
    return this.beginSessionLoad(sessionId, 'resume', () => this.resumeSession(sessionId))
  }

  /**
   * Dedup same-kind loads for one id. A prompt may wait out a resume
   * (inherit success, or lazily create after failure). A resume must not
   * inherit an in-flight create: that would report rehydration of a fresh
   * session.
   */
  private async beginSessionLoad(
    sessionId: string,
    kind: SessionLoadKind,
    load: () => Promise<SessionRecord>,
    inheritedCancel = false,
  ): Promise<SessionRecord> {
    if (this.shuttingDown) throw new Error('SDK server is shutting down')
    const existing = this.sessions.get(sessionId)
    if (existing) return existing
    const pending = this.sessionCreations.get(sessionId)
    if (pending) {
      if (pending.kind === kind) {
        if (kind === 'create') pending.promptWaiting = true
        return pending.task
      }
      if (kind === 'create') {
        pending.promptWaiting = true
        return pending.task.then(
          rec => rec,
          () => this.beginSessionLoad(sessionId, kind, load, pending.cancelled),
        )
      }
      throw new Error(`session ${sessionId} is already being created`)
    }
    const task = load()
    const entry: PendingSessionLoad = { kind, task, cancelled: inheritedCancel, promptWaiting: kind === 'create' }
    this.sessionCreations.set(sessionId, entry)
    void task.then(
      (rec) => {
        this.sessionCreations.delete(sessionId)
        if (entry.cancelled) rec.pendingCancel = true
      },
      () => { this.sessionCreations.delete(sessionId) },
    )
    return task
  }

  private async createSession(sessionId: string): Promise<SessionRecord> {
    // No preset composition: this server's compositions keep the model-facing
    // rows in the host plane, so this agent reads them from the global layer. A
    // deployment that configures a roster has to join one here first
    // (@deepseek-ai/dsh-agent-presets README, "Composing a child agent").
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(sessionId),
      meta: { cwd: this.cwd },
      agentOptions: {
        provider: this.provider,
        model: this.model,
        ...this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens },
      },
    })
    const rec: SessionRecord = { handle, pendingCancel: false }
    this.sessions.set(sessionId, rec)
    return rec
  }

  private async resumeSession(sessionId: string): Promise<SessionRecord> {
    const handle = await this.ctx.agents.resume({
      resumeSessionId: SessionId(sessionId),
      agentOptions: {
        provider: this.provider,
        model: this.model,
        ...this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens },
      },
    })
    const rec: SessionRecord = { handle, pendingCancel: false }
    this.sessions.set(sessionId, rec)
    return rec
  }

  private hasAdapterFor(provider: string): boolean {
    return this.ctx.get('llm')?.listProviders().some(entry => entry.id === provider) ?? false
  }

  /**
   * Ask the advertising client and map the answer. Transport loss, a
   * thrown handler, or {@link HarnessSdkJsonRpcServerOptions.approvalRequestTimeoutMs}
   * expiry becomes `'unavailable'` so the turn is not wedged.
   * A garbage result becomes `'rejected'` and never grants.
   */
  private relayApproval(request: ApprovalRequest): Promise<ApprovalOutcome> {
    const timeoutMs = this.options.approvalRequestTimeoutMs
    const timer = timeoutMs === undefined ? undefined : new AbortController()
    const timeout = timer === undefined || timeoutMs === undefined
      ? undefined
      : setTimeout(() => { timer.abort() }, timeoutMs)
    const signal = combineSignals(request.signal, timer?.signal)
    return this.transport.request('session/request_permission', {
      sessionId: String(request.agent.session.id),
      toolName: request.toolName,
      ...request.callId !== undefined ? { callId: request.callId } : {},
      ...request.reason !== undefined ? { reason: request.reason } : {},
    }, signal).then(
      (result) => {
        if (timeout !== undefined) clearTimeout(timeout)
        return permissionOutcome(result)
      },
      () => {
        if (timeout !== undefined) clearTimeout(timeout)
        return 'unavailable'
      },
    )
  }
}

/** Prefer the sole defined signal; otherwise abort when either fires. */
function combineSignals(left?: AbortSignal, right?: AbortSignal): AbortSignal | undefined {
  if (left === undefined) return right
  if (right === undefined) return left
  return AbortSignal.any([left, right])
}
