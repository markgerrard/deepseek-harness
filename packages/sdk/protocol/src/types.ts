/**
 * Named wire types for the DeepSeek Harness SDK runtime protocol: the five
 * client-to-server request/result pairs, the one server-to-client request,
 * and the four server-to-client notification payloads exchanged over the
 * newline-delimited JSON-RPC stdio transport. The server plugin
 * (`@deepseek-ai/dsh-sdk-jsonrpc-server`) and SDK clients share these shapes;
 * `serverInfo.name` stays the wire-stable `deepseek-harness-sdk-runtime`.
 *
 * @module @deepseek-ai/dsh-sdk-protocol/types
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SubagentStopReason } from '@deepseek-ai/dsh-subagent'

/**
 * Optional client features advertised at `initialize`. Omitted or false keeps
 * today's server behaviour: no server-to-client request is sent.
 */
export interface ClientCapabilities {
  /**
   * When `true`, the client answers `session/request_permission`. Any other
   * value is treated as absent.
   */
  approvals?: boolean
}

/** Parameters for the process-wide SDK handshake. */
export interface InitializeParams {
  /** Working directory recorded on every SDK-created session's header. */
  cwd: string
  /** Provider route every SDK-created agent runs on. */
  provider: string
  /** Model name every SDK-created agent runs on (the server may mount a fallback adapter; see `HarnessSdkJsonRpcServer.initialize`). */
  model: string
  /** Optional positive output-token cap inherited by SDK-created agents and their in-process descendants. */
  maxTokens?: number
  /**
   * Features this client implements. The server relays approval asks only when
   * {@link ClientCapabilities.approvals} is exactly `true`.
   */
  clientCapabilities?: ClientCapabilities
}

/** Wire-stable server identity returned by initialization. */
export interface InitializeResult {
  /** Wire-stable server identity (`deepseek-harness-sdk-runtime`) and version. */
  serverInfo: { name: string; version: string }
}

/** One user turn on one SDK session. */
export interface SessionPromptParams {
  /**
   * The SDK-side session id. An unknown id lazily creates a fresh agent+session
   * pair and does not rehydrate a persisted log — send `session/resume` first
   * when that is the intent.
   */
  sessionId: string
  /** The prompt content blocks, sent verbatim as the user message. */
  contentBlocks: ContentBlock[]
  /** Optional agent preset id to instantiate when lazily creating the session. */
  agentPreset?: string
  /** Optional LLM provider route for this session. */
  provider?: string
  /** Optional model name for this session. */
  model?: string
  /** Optional reasoning effort setting for models that support it. */
  reasoningEffort?: string
  /**
   * Deliver as steering: a running turn consumes the message at its next step
   * boundary instead of waiting behind it as a queued turn; an idle session
   * starts a turn either way. Omitted or `false` queues a followup turn.
   */
  steer?: boolean
}

/** Durable enqueue receipt for one prompt. */
export interface SessionPromptResult {
  /** Identity of the queued user message. */
  messageId: string
}

/** Parameters for cancelling one SDK session's in-flight turn. */
export interface SessionCancelParams {
  /** The SDK-side session id; an unknown id is a no-op. An in-flight lazy create or resume is cancelled, not unknown. */
  sessionId: string
  /**
   * Preserve queued and steering inbox work: the active turn still aborts,
   * but pending messages survive and a steering wake replays into a fresh
   * turn. Omitted or `false` clears the inbox with the abort.
   */
  keepInbox?: boolean
}

/** Parameters for rehydrating one persisted SDK session. */
export interface SessionResumeParams {
  /**
   * The persisted session id. Already-live ids succeed without reloading.
   * An in-flight lazy create for the same id rejects. A miss, corrupt log,
   * newer-harness log, or missing persistence backend rejects; this method
   * never creates a fresh session.
   */
  sessionId: string
  /** Optional LLM provider route override on resume. */
  provider?: string
  /** Optional model name override on resume. */
  model?: string
  /** Optional reasoning effort setting override on resume. */
  reasoningEffort?: string
}

/** Result returned when listing available agent presets. */
export interface PresetListResult {
  readonly presets: readonly PresetListItem[]
}

/** One preset item reported by the preset catalog. */
export interface PresetListItem {
  readonly id: string
  readonly trust: 'system' | 'user'
  readonly name?: string
  readonly description?: string
  readonly broken?: string
}

/** Parameters for copying an existing preset to a new user preset id. */
export interface PresetCopyParams {
  readonly from: string
  readonly id: string
  readonly name?: string
}

/** Parameters for setting the persona system-prompt text of a user preset. */
export interface PresetSetPersonaParams {
  readonly id: string
  readonly text: string
}

/** Parameters for updating the active LLM provider, model, and reasoning effort on an active SDK session. */
export interface SessionSetModelParams {
  readonly sessionId: string
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/**
 * Closed one-shot answers a client may return for
 * {@link SessionRequestPermissionParams}. Matches the approval seam's
 * `ApprovalOutcome` so a grant is only `'allowed-once'`.
 */
export type SdkPermissionOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** One approval ask the server relays to an advertising client. */
export interface SessionRequestPermissionParams {
  /** The SDK session whose agent is waiting. */
  sessionId: string
  /** Tool the ask is about. */
  toolName: string
  /** Tool-call id when the asker had one. */
  callId?: string
  /** Asker's human-readable explanation. */
  reason?: string
}

/** Client answer for one {@link SessionRequestPermissionParams}. */
export interface SessionRequestPermissionResult {
  /** Closed outcome; anything else on the wire is treated as `'rejected'`. */
  outcome: SdkPermissionOutcome
}

/** Deployment-mapped SDK outcome: `ok` for an accepted result, `error` otherwise. */
export type SdkRunStatus = 'ok' | 'error'

/** `session.event` payload: one session-log event, streamed as it is recorded. */
export interface SessionEventNotification {
  /** Session the event belongs to (every session in the runtime, not only SDK-created ones). */
  sessionId: string
  /** The full session-log event envelope. */
  event: SessionEvent
}

/** Whole-agent lifecycle state for one session. */
export interface SessionStatusNotification {
  /** Session whose live agent changed status. */
  sessionId: string
  /** The whole-agent state after the transition. */
  status: 'idle' | 'running'
}

/** `subagent.started` payload: an in-runtime child session was created. */
export interface SubagentStartedNotification {
  /** The delegating session. */
  parentSessionId: string
  /** The new child session. */
  childSessionId: string
}

/** `subagent.finished` payload: an in-process subagent run ended (remote runs are not reported). */
export interface SubagentFinishedNotification {
  /** Subagent provider name that ran the child. */
  provider: string
  /** The child agent's id (equals {@link childSessionId} for local runs). */
  agentId: string
  /** The delegating session. */
  parentSessionId: string
  /** The child session. */
  childSessionId: string
  /** Deployment-mapped run outcome. */
  status: SdkRunStatus
  /** The provider-reported stop reason. */
  stopReason: SubagentStopReason
  /** The child's selected assistant output; absent when the child produced none. */
  lastAssistantMessage?: ContentBlock[]
}

/** Server-to-client notifications by JSON-RPC method name. */
export interface HarnessSdkNotificationMap {
  'session.event': SessionEventNotification
  'session.status': SessionStatusNotification
  'subagent.started': SubagentStartedNotification
  'subagent.finished': SubagentFinishedNotification
}

/** Client-to-server request methods with their param and result shapes. */
export interface HarnessSdkRequestMap {
  'initialize': { params: InitializeParams; result: InitializeResult }
  'presets/list': { params: Record<string, never>; result: PresetListResult }
  'presets/copy': { params: PresetCopyParams; result: Record<string, never> }
  'presets/setPersona': { params: PresetSetPersonaParams; result: Record<string, never> }
  'session/prompt': { params: SessionPromptParams; result: SessionPromptResult }
  'session/cancel': { params: SessionCancelParams; result: Record<string, never> }
  'session/resume': { params: SessionResumeParams; result: Record<string, never> }
  'session/setModel': { params: SessionSetModelParams; result: Record<string, never> }
  'shutdown': { params: undefined; result: Record<string, never> }
}

/** Server-to-client request methods. Sent only after an approvals advertisement. */
export interface HarnessSdkServerRequestMap {
  'session/request_permission': {
    params: SessionRequestPermissionParams
    result: SessionRequestPermissionResult
  }
}
