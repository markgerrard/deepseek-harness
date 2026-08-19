import Foundation
import Observation

public struct PermissionRequest: Identifiable, Equatable, Sendable {
  public var id: String
  public var sessionId: String
  public var toolName: String
  public var callId: String
  public var reason: String?

  public init(id: String = UUID().uuidString, sessionId: String, toolName: String, callId: String, reason: String? = nil) {
    self.id = id
    self.sessionId = sessionId
    self.toolName = toolName
    self.callId = callId
    self.reason = reason
  }
}

public enum SessionControllerError: Error, LocalizedError, Equatable, Sendable {
  case invalidDisplayName(String)
  case botNotFound(String)
  case threadNotFound(String)
  case noThreadSelected

  public var errorDescription: String? {
    switch self {
    case .invalidDisplayName(let name):
      return "Invalid bot display name '\(name)' (must produce a non-empty alphanumeric slug)"
    case .botNotFound(let id):
      return "Bot with id '\(id)' not found"
    case .threadNotFound(let id):
      return "Thread with id '\(id)' not found"
    case .noThreadSelected:
      return "No thread selected"
    }
  }
}

@Observable
@MainActor
public final class SessionController {
  public let client: HarnessClient
  public var store: BotStore
  public var selectedBotId: String?
  public var selectedThreadId: String?

  public private(set) var eventsBySession: [String: [SessionEventDTO]] = [:]
  public var transcriptExpansion: TranscriptExpansion = TranscriptExpansion()
  public private(set) var threadErrors: [String: String] = [:]
  public private(set) var initializationError: String?

  public private(set) var pendingApproval: PermissionRequest?
  @ObservationIgnored private var pendingApprovalContinuation: CheckedContinuation<SdkPermissionOutcome, Never>?
  @ObservationIgnored nonisolated(unsafe) private var eventListeningTask: Task<Void, Never>?

  public init(client: HarnessClient, store: BotStore) {
    self.client = client
    self.store = store
    self.selectedBotId = store.bots.first?.id
    if let botId = self.selectedBotId {
      self.selectedThreadId = store.threads(forBot: botId).first?.id
    }

    client.onRequest { [weak self] method, params in
      guard let self = self else {
        return .object(["outcome": .string(outcomeForDismissedSheet().rawValue)])
      }
      if method == "session/request_permission" {
        let sessionId = params["sessionId"]?.stringValue ?? ""
        let toolName = params["toolName"]?.stringValue ?? ""
        let callId = params["callId"]?.stringValue ?? ""
        let reason = params["reason"]?.stringValue
        let req = PermissionRequest(sessionId: sessionId, toolName: toolName, callId: callId, reason: reason)
        let outcome = await self.handlePermissionRequest(req)
        return .object(["outcome": .string(outcome.rawValue)])
      }
      throw HarnessRPCError(code: -32601, message: "Method not found: \(method)")
    }

    self.eventListeningTask = Task { @MainActor [weak self] in
      guard let self = self else { return }
      for await notification in self.client.events {
        self.processEventNotification(notification)
      }
    }
  }

  deinit {
    eventListeningTask?.cancel()
  }

  public var bots: [Bot] {
    store.bots
  }

  public var selectedBot: Bot? {
    guard let id = selectedBotId else { return nil }
    return bots.first(where: { $0.id == id })
  }

  public func threads(forBot botId: String) -> [Thread] {
    store.threads(forBot: botId)
  }

  public var threadsForSelectedBot: [Thread] {
    guard let botId = selectedBotId else { return [] }
    return store.threads(forBot: botId)
  }

  public var selectedThread: Thread? {
    guard let threadId = selectedThreadId else { return nil }
    for bot in bots {
      let ths = store.threads(forBot: bot.id)
      if let found = ths.first(where: { $0.id == threadId }) {
        return found
      }
    }
    return nil
  }

  public var currentTranscript: [TranscriptItem] {
    guard let threadId = selectedThreadId else { return [] }
    return transcript(for: threadId)
  }

  public func transcript(for sessionId: String) -> [TranscriptItem] {
    let events = eventsBySession[sessionId] ?? []
    return projectTranscript(events, expansion: transcriptExpansion)
  }

  public func selectBot(id: String) {
    selectedBotId = id
    let ths = store.threads(forBot: id)
    if let currentThread = selectedThreadId, ths.contains(where: { $0.id == currentThread }) {
      // keep current thread if it belongs to selected bot
    } else {
      selectedThreadId = ths.first?.id
    }
  }

  public func selectThread(id: String) {
    selectedThreadId = id
    if let bot = store.bot(forThread: id) {
      selectedBotId = bot.id
    }
  }

  public static func slugify(_ displayName: String) throws -> String {
    let lower = displayName.lowercased()
    var tokens: [String] = []
    var currentToken = ""

    for scalar in lower.unicodeScalars {
      if (scalar >= "a" && scalar <= "z") || (scalar >= "0" && scalar <= "9") {
        currentToken.append(Character(scalar))
      } else {
        if !currentToken.isEmpty {
          tokens.append(currentToken)
          currentToken = ""
        }
      }
    }
    if !currentToken.isEmpty {
      tokens.append(currentToken)
    }

    let slug = tokens.joined(separator: "-")

    guard !slug.isEmpty,
          let first = slug.first,
          (first >= "a" && first <= "z") || (first >= "0" && first <= "9") else {
      throw SessionControllerError.invalidDisplayName(displayName)
    }

    return slug
  }

  @discardableResult
  public func createBot(
    displayName: String,
    job: String,
    provider: String,
    model: String,
    thinking: String = "off",
    template: String = "code"
  ) async throws -> Bot {
    let slug = try Self.slugify(displayName)
    try await client.copyPreset(from: template, id: slug, name: displayName)
    let suffix = " Your working directory is {{cwd}}. You are powered by the {{model}} model."
    let personaText = job + suffix
    try await client.setPersona(id: slug, text: personaText)
    let bot = Bot(
      id: slug,
      displayName: displayName,
      provider: provider,
      model: model,
      reasoningEffort: thinking,
      threadIDs: []
    )
    try store.addBot(bot)
    selectBot(id: slug)
    return bot
  }

  @discardableResult
  public func newThread(
    forBot bot: Bot,
    initialPrompt: String,
    title: String? = nil
  ) async throws -> Thread {
    let sessionId = UUID().uuidString
    let trimmed = initialPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
    let threadTitle = title ?? (trimmed.isEmpty ? "New Thread" : String(trimmed.prefix(50)))
    let thread = Thread(id: sessionId, botID: bot.id, title: threadTitle)
    try store.addThread(thread)
    selectThread(id: sessionId)

    if !trimmed.isEmpty {
      do {
        _ = try await client.prompt(
          sessionId: sessionId,
          text: initialPrompt,
          agentPreset: bot.id,
          provider: bot.provider,
          model: bot.model,
          reasoningEffort: bot.reasoningEffort
        )
      } catch {
        handleKeyError(error, sessionId: sessionId)
        throw error
      }
    }

    return thread
  }

  @discardableResult
  public func sendPrompt(threadId: String, text: String) async throws -> String {
    guard let bot = store.bot(forThread: threadId) else {
      throw SessionControllerError.threadNotFound(threadId)
    }
    do {
      let msgId = try await client.prompt(
        sessionId: threadId,
        text: text,
        agentPreset: bot.id,
        provider: bot.provider,
        model: bot.model,
        reasoningEffort: bot.reasoningEffort
      )
      return msgId
    } catch {
      handleKeyError(error, sessionId: threadId)
      throw error
    }
  }

  public func initialize(cwd: String, provider: String, model: String, approvals: Bool = true) async throws {
    do {
      try await client.initialize(cwd: cwd, provider: provider, model: model, approvals: approvals)
    } catch {
      if let keyMsg = extractKeyError(error) {
        initializationError = keyMsg
      }
      throw error
    }
  }

  private func extractKeyError(_ error: Error) -> String? {
    let msg = (error as? HarnessRPCError)?.message ?? error.localizedDescription
    if msg.contains("DEEPSEEK_API_KEY") ||
       msg.contains("OPENCODE_API_KEY") ||
       msg.contains("CLINE_API_KEY") {
      return msg
    }
    return nil
  }

  private func handleKeyError(_ error: Error, sessionId: String) {
    if let msg = extractKeyError(error) {
      threadErrors[sessionId] = msg
    }
  }

  public func appendEvent(_ event: SessionEventDTO, forSessionId sessionId: String) {
    var list = eventsBySession[sessionId] ?? []
    list.append(event)
    eventsBySession[sessionId] = list
  }

  public func setEvents(_ events: [SessionEventDTO], forSessionId sessionId: String) {
    eventsBySession[sessionId] = events
  }

  public func processEventNotification(_ notification: SessionEventNotification) {
    let sessionId = notification.sessionId
    let eventDict = notification.event
    let type = eventDict["type"]?.stringValue ?? ""
    let seq = eventDict["seq"]?.intValue ?? 0
    let data = eventDict["data"] ?? .null
    let dto = SessionEventDTO(type: type, seq: seq, data: data)
    appendEvent(dto, forSessionId: sessionId)
  }

  public func handlePermissionRequest(_ request: PermissionRequest) async -> SdkPermissionOutcome {
    await withCheckedContinuation { continuation in
      self.pendingApproval = request
      self.pendingApprovalContinuation = continuation
    }
  }

  public func respondToPendingApproval(with outcome: SdkPermissionOutcome) {
    pendingApproval = nil
    let continuation = pendingApprovalContinuation
    pendingApprovalContinuation = nil
    continuation?.resume(returning: outcome)
  }

  public func dismissPendingApproval() {
    respondToPendingApproval(with: outcomeForDismissedSheet())
  }

  public func toggleExpansion(id: String, kind: String) {
    switch kind {
    case "tool":
      transcriptExpansion.tools = toggleId(transcriptExpansion.tools, id: id)
    case "reasoning":
      transcriptExpansion.reasoning = toggleId(transcriptExpansion.reasoning, id: id)
    case "workflow":
      transcriptExpansion.workflows = toggleId(transcriptExpansion.workflows, id: id)
    default:
      break
    }
  }
}
