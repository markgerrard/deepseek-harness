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
}

type SessionLoadKind = 'create' | 'resume'

/**
 * One client operation that arrived while a session load was in flight,
 * held in wire arrival order until the load settles. A cancel carries the
 * resolver of its own RPC's promise, so that RPC resolves once its fate is
 * decided — its abort ran, or it was dropped — instead of waiting out a
 * load graph it has no stake in. The op object transfers by reference into
 * a successor load, so the settlement travels with it.
 */
type QueuedSessionOp =
  | { kind: 'prompt'; message: ReturnType<typeof createUserMessage> }
  | { kind: 'cancel'; settle: () => void }

interface PendingSessionLoad {
  kind: SessionLoadKind
  /** Settlement of this load attempt alone. */
  task: Promise<SessionRecord>
  /**
   * Prompts and cancels that arrived while this load was in flight, in wire
   * arrival order. Each RPC handler appends synchronously, so the queue's
   * order is the client's order by construction; the load's own settlement
   * continuation replays it against the live agent in one pass, so no later
   * continuation can reorder delivery.
   */
  queue: QueuedSessionOp[]
  /**
   * The final record after replay, adopting the successor create's outcome
   * when a failed resume hands its queue over. Queued prompts await this;
   * queued cancels settle their own promise at their own fate, and the
   * `session/resume` RPC awaits {@link task}, because its result is this
   * attempt's own.
   */
  outcome: Promise<SessionRecord>
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
    if (this.shuttingDown) throw new Error('SDK server is shutting down')
    // A pending load owns delivery order for its session, so the pending map
    // is consulted before the record map: a record published mid-load must not
    // let this prompt bypass operations already queued ahead of it.
    const rec = this.sessions.get(params.sessionId)
    if (rec === undefined || this.sessionCreations.has(params.sessionId)) {
      const pending = this.sessionCreations.get(params.sessionId)
        ?? this.beginSessionLoad(params.sessionId, 'create', () => this.createSession(params.sessionId))
      const message = createUserMessage({ content: params.contentBlocks, source: { kind: 'user' } })
      pending.queue.push({ kind: 'prompt', message })
      await pending.outcome
      return { messageId: message.id }
    }
    // An agent-loop-only reload disposes the loop's agents while this record
    // survives; a retained agent accepts followup() silently, so validate the
    // record against the live registry before delivery (as the ACP bridge does).
    if (this.ctx.agents.get(rec.handle.agent.id) !== rec.handle.agent) {
      throw new Error(`session agent was disposed outside the server: ${params.sessionId}`)
    }
    const message = createUserMessage({ content: params.contentBlocks, source: { kind: 'user' } })
    rec.handle.agent.followup(message)
    return { messageId: message.id }
  }

  /**
   * Abort the addressed session's in-flight turn and queued inbox work.
   * Unknown session ids are a no-op so a late cancel after teardown cannot
   * fail the client — for the same reason this method has no shutdown guard:
   * a cancel racing teardown still joins an outstanding queue, while prompts
   * and resumes reject once shutdown begins. An in-flight lazy create or
   * resume is not unknown: the cancel joins that load's operation queue in
   * wire order and is replayed at settlement, so it aborts exactly the
   * prompts queued ahead of it and never one queued after it —
   * `agent.cancel` does not arm later work, and the replay places it. Each
   * queued cancel carries its own settlement, so the RPC resolves `{}` at
   * the moment that cancel's fate is decided and never waits on work it has
   * no stake in: after its abort ran in a replay, at the transfer that drops
   * it as a leading cancel, or when a dead load or a refused replay drops
   * the queue. It resolves `{}` in every one of those outcomes, including
   * the ones that abort nothing.
   * @param params - the session to cancel.
   * @returns empty JSON-RPC result.
   */
  cancel(params: SessionCancelParams): Promise<Record<string, never>> {
    const pending = this.sessionCreations.get(params.sessionId)
    if (pending !== undefined) {
      const { promise, resolve } = Promise.withResolvers<void>()
      pending.queue.push({ kind: 'cancel', settle: resolve })
      // Resolves once this cancel's own fate is settled — never merely
      // because the resume rejected, which would acknowledge before a
      // transferred abort ran, and never against a successor this cancel
      // was dropped from.
      return promise.then(() => ({}))
    }
    const rec = this.sessions.get(params.sessionId)
    if (rec !== undefined) {
      rec.handle.agent.cancel({ kind: 'user' })
      return Promise.resolve({})
    }
    return Promise.resolve({})
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
    if (this.shuttingDown) throw new Error('SDK server is shutting down')
    const pending = this.sessionCreations.get(params.sessionId)
    if (pending !== undefined) {
      // A resume must not inherit an in-flight create: that would report
      // rehydration of a fresh session. Joining an in-flight resume shares
      // this attempt's own result, not a successor's.
      if (pending.kind === 'create') throw new Error(`session ${params.sessionId} is already being created`)
      await pending.task
      return {}
    }
    if (this.sessions.has(params.sessionId)) return {}
    await this.beginSessionLoad(params.sessionId, 'resume', () => this.resumeSession(params.sessionId)).task
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

  /**
   * Deliver a settled load's queued operations to its live agent in wire
   * order. Delivery is assumed non-throwing: `followup` and `cancel` are
   * inbox operations, and their synchronous event listeners must not throw.
   * A listener that does throw abandons the rest of the queue and rejects
   * every queued prompt, including ones already delivered.
   */
  private replayQueue(sessionId: string, rec: SessionRecord, queue: QueuedSessionOp[]): void {
    if (queue.length === 0) return
    // An agent-loop-only reload disposes the loop's agents while this record
    // survives; a retained agent accepts followup() silently, so validate the
    // record against the live registry before delivery. One check covers the
    // whole replay: it runs in one continuation, and the registry cannot
    // change between its statements.
    if (this.ctx.agents.get(rec.handle.agent.id) !== rec.handle.agent) {
      throw new Error(`session agent was disposed outside the server: ${sessionId}`)
    }
    for (const op of queue) {
      if (op.kind === 'cancel') rec.handle.agent.cancel({ kind: 'user' })
      else rec.handle.agent.followup(op.message)
    }
  }

  /**
   * Start one session load and take ownership of its operation queue. The
   * settlement continuation registered here is the first reaction on the
   * load, so it replays the queue before any joiner's continuation runs —
   * delivery order cannot depend on how deep a joiner's promise chain is.
   * A failed resume whose queue still holds a prompt continues into a lazy
   * create and hands the queue over; cancels at the front of that queue have
   * nothing ahead of them to sweep and die with the failed load.
   */
  private beginSessionLoad(
    sessionId: string,
    kind: SessionLoadKind,
    load: () => Promise<SessionRecord>,
  ): PendingSessionLoad {
    const queue: QueuedSessionOp[] = []
    const task = load()
    const outcome = task.then(
      (rec) => {
        this.sessionCreations.delete(sessionId)
        try {
          this.replayQueue(sessionId, rec, queue)
        } finally {
          // Delivered cancels ran their abort in the replay above; a replay
          // refused by the registry check dropped the rest. Either way every
          // queued cancel's fate is now decided.
          for (const op of queue) if (op.kind === 'cancel') op.settle()
        }
        return rec
      },
      (error: unknown) => {
        this.sessionCreations.delete(sessionId)
        if (kind === 'resume' && !this.shuttingDown) {
          // A leading cancel has nothing ahead of it to sweep in a successor
          // whose contents all postdate it: dropped, and settled at the drop.
          for (let head = queue[0]; head?.kind === 'cancel'; head = queue[0]) {
            head.settle()
            queue.shift()
          }
          if (queue.length > 0) {
            const successor = this.beginSessionLoad(sessionId, 'create', () => this.createSession(sessionId))
            successor.queue.push(...queue)
            return successor.outcome
          }
        }
        for (const op of queue) if (op.kind === 'cancel') op.settle()
        throw error
      },
    )
    // Only queued prompts await this outcome — queued cancels settle their
    // own promises — so a failed load whose queue held no prompt rejects it
    // with no awaiter; mark it handled without affecting real awaiters.
    void outcome.then(undefined, () => undefined)
    const entry: PendingSessionLoad = { kind, task, queue, outcome }
    this.sessionCreations.set(sessionId, entry)
    return entry
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
    const rec: SessionRecord = { handle }
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
    const rec: SessionRecord = { handle }
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
