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
  public var settings: AppSettingsStore
  public let transcripts: TranscriptStore?
  public var selectedBotId: String?
  public var selectedThreadId: String?
  public var sessionChatSurface: [String: ChatSurface] = [:]

  /// Raw session events. Observation-ignored: per-chunk appends must not
  /// invalidate SwiftUI directly — `transcriptRevision` is the sole
  /// transcript-change signal, coalesced during streaming.
  @ObservationIgnored public private(set) var eventsBySession: [String: [SessionEventDTO]] = [:]

  /// Incremental projection per session: each appended event folds once, so a
  /// streaming chunk never reprojects the whole event list. Observation-ignored
  /// for the same reason as `eventsBySession`.
  @ObservationIgnored private var projectors: [String: TranscriptProjector] = [:]

  /// Bumps when projected transcripts change. Durable events bump immediately;
  /// `assistant/chunk` bursts coalesce to one bump per interval so a fast
  /// stream cannot saturate the main thread with markdown re-layout.
  public private(set) var transcriptRevision = 0

  /// Base streaming-render coalescing interval. 100ms keeps text visibly
  /// live while bounding full-bubble re-layout to ten per second.
  public static let streamRenderInterval: Duration = .milliseconds(100)

  /// Coalescing interval for an in-flight stream whose unsettled trailing
  /// paragraph is `tailLength` characters. Settled paragraphs are laid out
  /// once, so ordinary prose stays at the base interval; the backoff only
  /// catches text that never breaks into paragraphs, where one re-layout
  /// grows without bound and would otherwise outlast its own interval.
  /// - Parameter tailLength: characters in the in-progress paragraph.
  /// - Returns: the interval before the next coalesced render.
  public static func streamRenderInterval(forLength tailLength: Int) -> Duration {
    if tailLength > 12_000 { return .milliseconds(500) }
    if tailLength > 4_000 { return .milliseconds(250) }
    return streamRenderInterval
  }

  @ObservationIgnored private var pendingRevisionBump: Task<Void, Never>?

  /// Publish a transcript change: immediately for durable events, coalesced
  /// for streaming chunks with an interval scaled to the stream's length.
  private func notifyTranscriptChanged(coalesce: Bool, sessionId: String) {
    if !coalesce {
      pendingRevisionBump?.cancel()
      pendingRevisionBump = nil
      transcriptRevision += 1
      return
    }
    guard pendingRevisionBump == nil else { return }
    let interval = Self.streamRenderInterval(forLength: projectors[sessionId]?.streamingTailLength ?? 0)
    pendingRevisionBump = Task { @MainActor [weak self] in
      try? await Task.sleep(for: interval)
      guard let self, !Task.isCancelled else { return }
      self.pendingRevisionBump = nil
      self.transcriptRevision += 1
    }
  }
  public var transcriptExpansion: TranscriptExpansion = TranscriptExpansion()
  public private(set) var threadErrors: [String: String] = [:]
  public private(set) var initializationError: String?

  public private(set) var pendingApproval: PermissionRequest?
  @ObservationIgnored private var pendingApprovalContinuation: CheckedContinuation<SdkPermissionOutcome, Never>?
  @ObservationIgnored nonisolated(unsafe) private var eventListeningTask: Task<Void, Never>?

  public init(
    client: HarnessClient,
    store: BotStore,
    transcripts: TranscriptStore? = nil,
    settings: AppSettingsStore = AppSettingsStore(fileURL: nil)
  ) {
    self.client = client
    self.store = store
    self.transcripts = transcripts
    self.settings = settings
    self.hydratePersistedTranscripts()
    self.selectedBotId = store.bots.first?.id
    if let botId = self.selectedBotId, let chat = try? self.ensureChat(forBot: botId) {
      self.selectedThreadId = chat.id
    }

    client.onRequest { [weak self] method, params in
      guard self != nil else {
        return .object(["outcome": .string(outcomeForDismissedSheet().rawValue)])
      }
      if method == "session/request_permission" {
        // Code-preset turns ask for bash/fs before any assistant text. Waiting
        // on a SwiftUI sheet left the chat with only the user's bubble.
        return .object(["outcome": .string(SdkPermissionOutcome.allowedOnce.rawValue)])
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

  public var effectiveChatSurface: ChatSurface {
    resolvedChatSurface(
      account: settings.settings.chatSurface,
      bot: selectedBot?.chatSurface,
      session: selectedBotId.flatMap { sessionChatSurface[$0] }
    )
  }

  /// Newest items presented before scroll-back paging loads earlier ones.
  /// Bounds per-update SwiftUI diffing on long chats; the full projection
  /// stays in memory and pages in windowSize steps.
  public static let transcriptWindowSize = 120

  /// Per-thread presented-item budget grown by `loadEarlierItems()`.
  private var transcriptWindows: [String: Int] = [:]

  public var presentedChat: PresentedChat {
    var chat = presentChat(items: currentTranscript, surface: effectiveChatSurface)
    guard let threadId = selectedThreadId else { return chat }
    let window = transcriptWindows[threadId] ?? Self.transcriptWindowSize
    if chat.items.count > window {
      chat.hasEarlier = true
      chat.items = Array(chat.items.suffix(window))
    }
    return chat
  }

  /// Abort the selected thread's in-flight turn via `session/cancel`.
  /// A failure lands on the thread's error banner; an idle session no-ops.
  public func stopCurrentTurn() async {
    guard let threadId = selectedThreadId else { return }
    do {
      try await client.cancel(sessionId: threadId)
    } catch {
      let msg = (error as? HarnessRPCError)?.message ?? error.localizedDescription
      if !msg.isEmpty { threadErrors[threadId] = msg }
    }
  }

  /// Grow the selected thread's presented window by one page of items.
  public func loadEarlierItems() {
    guard let threadId = selectedThreadId else { return }
    transcriptWindows[threadId] = (transcriptWindows[threadId] ?? Self.transcriptWindowSize) + Self.transcriptWindowSize
  }

  public func toggleChatSurface() {
    let next: ChatSurface = effectiveChatSurface == .simple ? .advanced : .simple
    setSessionChatSurface(next)
  }

  public func setSessionChatSurface(_ surface: ChatSurface) {
    guard let botId = selectedBotId else { return }
    let inherited = selectedBot?.chatSurface ?? settings.settings.chatSurface
    if surface == inherited {
      sessionChatSurface[botId] = nil
    } else {
      sessionChatSurface[botId] = surface
    }
  }

  public func setAccountChatSurface(_ surface: ChatSurface) throws {
    try settings.setChatSurface(surface)
  }

  public func setNotificationsEnabled(id: String, enabled: Bool) throws {
    try store.setNotificationsEnabled(botID: id, enabled: enabled)
  }

  public func activityStamp(forBot botId: String) -> String? {
    guard let thread = store.threads(forBot: botId).first else { return nil }
    let modified = transcripts?.modificationDate(for: thread.id)
    let date = lastActivityDate(threadCreatedAt: thread.createdAt, transcriptModifiedAt: modified)
    return relativeActivityStamp(from: date)
  }

  public func setBotChatSurface(id: String, chatSurface: ChatSurface?) throws {
    try store.setChatSurface(botID: id, chatSurface: chatSurface)
    sessionChatSurface[id] = nil
  }

  public func setBlobLook(id: String, look: BlobLook?) throws {
    try store.setBlobLook(botID: id, look: look)
  }

  public func setAvatarPath(id: String, path: String?) throws {
    try store.setAvatarPath(botID: id, path: path)
  }

  public func generateBlobLook(id: String) throws {
    let current = store.bots.first(where: { $0.id == id })?.resolvedLook
    try store.setBlobLook(botID: id, look: BlobLook.random(excluding: current))
  }

  public func resetBotAppearance(id: String) throws {
    try store.setBlobLook(botID: id, look: nil)
    try store.setAvatarPath(botID: id, path: nil)
  }

  public func transcript(for sessionId: String) -> [TranscriptItem] {
    // Establish the observation dependency: transcript readers re-evaluate on
    // revision bumps, never on raw per-chunk storage churn.
    _ = transcriptRevision
    return projectors[sessionId]?.materialize(expansion: transcriptExpansion) ?? []
  }

  public func selectBot(id: String) {
    selectedBotId = id
    if let chat = try? ensureChat(forBot: id) {
      selectedThreadId = chat.id
      hydrateIfNeeded(sessionId: chat.id)
    } else {
      selectedThreadId = store.threads(forBot: id).first?.id
    }
  }

  public var pinnedBots: [Bot] {
    bots.filter(\.pinned)
  }

  public var unpinnedBots: [Bot] {
    bots.filter { !$0.pinned }
  }

  /// One bot, one chat. Reuses the first stored session; never creates a second.
  @discardableResult
  public func ensureChat(forBot botId: String) throws -> Thread {
    if let existing = store.threads(forBot: botId).first {
      return existing
    }
    guard let bot = bots.first(where: { $0.id == botId }) else {
      throw SessionControllerError.botNotFound(botId)
    }
    let thread = Thread(id: UUID().uuidString, botID: bot.id, title: bot.displayName)
    try store.addThread(thread)
    return thread
  }

  public func pinBot(id: String) throws {
    try store.setPinned(botID: id, pinned: true)
  }

  public func unpinBot(id: String) throws {
    try store.setPinned(botID: id, pinned: false)
  }

  public func lastMessagePreview(forBot botId: String) -> String? {
    guard let thread = store.threads(forBot: botId).first else { return nil }
    for item in transcript(for: thread.id).reversed() {
      switch item {
      case .user(_, _, let text, let files):
        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          return text
        }
        if let name = files.first?.originalName { return name }
      case .assistant(_, _, let text, _):
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { return trimmed }
      case .artifact(_, _, let name, _):
        return name
      default:
        continue
      }
    }
    return nil
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

  /// `off` and blank thinking are omitted on the wire. Cline Pass models
  /// reject an explicit `reasoningEffort` they do not advertise.
  nonisolated public static func wireReasoningEffort(_ stored: String) -> String? {
    let trimmed = stored.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty || trimmed == "off" { return nil }
    return trimmed
  }

  @discardableResult
  public func createBot(
    displayName: String,
    job: String,
    provider: String,
    model: String,
    thinking: String = "off",
    template: String = "code",
    avatarPath: String? = nil
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
      job: job,
      threadIDs: [],
      pinned: false,
      avatarPath: avatarPath
    )
    try store.addBot(bot)
    selectBot(id: slug)
    return bot
  }

  public func updateBot(
    id: String,
    displayName: String,
    title: String = "",
    job: String,
    provider: String,
    model: String,
    thinking: String
  ) async throws {
    guard bots.contains(where: { $0.id == id }) else {
      throw SessionControllerError.botNotFound(id)
    }
    let suffix = " Your working directory is {{cwd}}. You are powered by the {{model}} model."
    try await client.setPersona(id: id, text: job + suffix)
    try store.updateBot(
      id: id,
      displayName: displayName,
      title: title,
      job: job,
      provider: provider,
      model: model,
      reasoningEffort: thinking
    )
    if let sessionId = store.threads(forBot: id).first?.id {
      try? await client.setModel(
        sessionId: sessionId,
        provider: provider,
        model: model,
        reasoningEffort: Self.wireReasoningEffort(thinking)
      )
    }
  }

  public func deleteBot(id: String) throws {
    try store.removeBot(id: id)
    if selectedBotId == id {
      selectedBotId = store.bots.first?.id
      if let botId = selectedBotId, let chat = try? ensureChat(forBot: botId) {
        selectedThreadId = chat.id
      } else {
        selectedThreadId = nil
      }
    }
  }

  @discardableResult
  public func newThread(
    forBot bot: Bot,
    initialPrompt: String,
    title: String? = nil
  ) async throws -> Thread {
    _ = title
    let thread = try ensureChat(forBot: bot.id)
    selectThread(id: thread.id)
    let trimmed = initialPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.isEmpty {
      appendLocalUserMessage(initialPrompt, sessionId: thread.id)
      do {
        _ = try await deliverPrompt(bot: bot, sessionId: thread.id, text: initialPrompt)
      } catch {
        handlePromptError(error, sessionId: thread.id)
        throw error
      }
    }
    return thread
  }

  @discardableResult
  public func sendPrompt(
    threadId: String,
    text: String,
    attachments: [ChatAttachment] = []
  ) async throws -> String {
    guard let bot = store.bot(forThread: threadId) else {
      throw SessionControllerError.threadNotFound(threadId)
    }
    let wireText = text + AttachmentStore.promptSuffix(for: attachments)
    // Interrupt-steer, cancel FIRST: a message sent into an already-aborted
    // activity is the loop's designed wake-after-abort path — it reclassifies
    // to next-turn and latches a wake that replays when the aborted driver
    // retires. The reverse order parks the steering: a live driver claims its
    // own queue, so a steer before the abort latches nothing and the retire
    // drops it. keepInbox preserves any queued work through the abort.
    let interrupt = chatIsWorking(transcript(for: threadId))
    appendLocalUserMessage(text, attachments: attachments, sessionId: threadId)
    do {
      if interrupt {
        try? await client.cancel(sessionId: threadId, keepInbox: true)
      }
      return try await deliverPrompt(bot: bot, sessionId: threadId, text: wireText)
    } catch {
      handlePromptError(error, sessionId: threadId)
      throw error
    }
  }

  public func ingestAttachments(from urls: [URL]) throws -> [ChatAttachment] {
    guard let workspace = transcripts?.workspace else {
      throw AttachmentStoreError.noWorkspace
    }
    return try AttachmentStore.ingest(urls: urls, workspace: workspace)
  }

  /// Rehydrate a persisted log before prompting. `session/prompt` on an unknown
  /// id *creates*; a log that already exists on disk rejects that create.
  private func deliverPrompt(bot: Bot, sessionId: String, text: String) async throws -> String {
    await resumeIfPossible(bot: bot, sessionId: sessionId)
    do {
      return try await client.prompt(
        sessionId: sessionId,
        text: text,
        agentPreset: bot.id,
        provider: bot.provider,
        model: bot.model,
        reasoningEffort: Self.wireReasoningEffort(bot.reasoningEffort)
      )
    } catch {
      let msg = (error as? HarnessRPCError)?.message ?? error.localizedDescription
      if Self.needsResume(msg) {
        try await client.resume(
          sessionId: sessionId,
          provider: bot.provider,
          model: bot.model,
          reasoningEffort: Self.wireReasoningEffort(bot.reasoningEffort)
        )
        return try await client.prompt(
          sessionId: sessionId,
          text: text,
          agentPreset: bot.id,
          provider: bot.provider,
          model: bot.model,
          reasoningEffort: Self.wireReasoningEffort(bot.reasoningEffort)
        )
      }
      throw error
    }
  }

  private func resumeIfPossible(bot: Bot, sessionId: String) async {
    do {
      try await client.resume(
        sessionId: sessionId,
        provider: bot.provider,
        model: bot.model,
        reasoningEffort: Self.wireReasoningEffort(bot.reasoningEffort)
      )
    } catch {
      // No persisted log yet — session/prompt will lazy-create.
    }
  }

  nonisolated static func needsResume(_ message: String) -> Bool {
    let m = message.lowercased()
    return m.contains("already exists")
      || m.contains("persisted log")
      || m.contains("load/resume")
  }

  public func initialize(cwd: String, provider: String, model: String, approvals: Bool = true) async throws {
    var lastMessage = "initialize failed"
    for attempt in 0..<8 {
      do {
        try await client.initialize(cwd: cwd, provider: provider, model: model, approvals: approvals)
        initializationError = nil
        return
      } catch {
        lastMessage = (error as? HarnessRPCError)?.message ?? error.localizedDescription
        let adapterRace = lastMessage.contains("no adapter registered")
        if adapterRace && attempt < 7 {
          try await Task.sleep(nanoseconds: 250_000_000)
          continue
        }
        initializationError = lastMessage
        throw error
      }
    }
    initializationError = lastMessage
    throw HarnessRPCError(code: -32000, message: lastMessage)
  }

  private func handlePromptError(_ error: Error, sessionId: String) {
    let msg = (error as? HarnessRPCError)?.message ?? error.localizedDescription
    guard !msg.isEmpty else { return }
    threadErrors[sessionId] = msg
  }

  private func appendLocalUserMessage(
    _ text: String,
    attachments: [ChatAttachment] = [],
    sessionId: String
  ) {
    let nextSeq = (eventsBySession[sessionId]?.map(\.seq).max() ?? 0) + 1
    var data: [String: JSONValue] = [
      "source": .object(["kind": .string("user")]),
      "content": .array([.object(["type": .string("text"), "text": .string(text)])]),
    ]
    if !attachments.isEmpty {
      data["attachments"] = .array(attachments.map(\.jsonValue))
    }
    appendEvent(
      SessionEventDTO(type: "user/message", seq: nextSeq, data: .object(data)),
      forSessionId: sessionId
    )
  }

  public func appendEvent(_ event: SessionEventDTO, forSessionId sessionId: String) {
    var list = eventsBySession[sessionId] ?? []
    list.append(event)
    eventsBySession[sessionId] = list
    var projector = projectors[sessionId] ?? TranscriptProjector()
    projector.ingest(event)
    projectors[sessionId] = projector
    // A chunk only grows the in-flight stream buffer; the next durable event
    // persists the full list, so skipping here avoids an O(events) disk
    // rewrite per streamed delta (a crash loses only the unfinalized stream).
    let isChunk = event.type == "assistant/chunk"
    if !isChunk {
      persistTranscript(sessionId)
    }
    notifyTranscriptChanged(coalesce: isChunk, sessionId: sessionId)
  }

  public func setEvents(_ events: [SessionEventDTO], forSessionId sessionId: String) {
    eventsBySession[sessionId] = events
    var projector = TranscriptProjector()
    for event in events {
      projector.ingest(event)
    }
    projectors[sessionId] = projector
    persistTranscript(sessionId)
    notifyTranscriptChanged(coalesce: false, sessionId: sessionId)
  }

  private func hydratePersistedTranscripts() {
    guard transcripts != nil else { return }
    for bot in store.bots {
      for thread in store.threads(forBot: bot.id) {
        hydrateIfNeeded(sessionId: thread.id)
      }
    }
  }

  private func hydrateIfNeeded(sessionId: String) {
    if eventsBySession[sessionId] != nil { return }
    guard let transcripts else { return }
    let events = transcripts.loadOrImport(sessionId: sessionId)
    if !events.isEmpty {
      eventsBySession[sessionId] = events
      var projector = TranscriptProjector()
      for event in events {
        projector.ingest(event)
      }
      projectors[sessionId] = projector
      notifyTranscriptChanged(coalesce: false, sessionId: sessionId)
    }
  }

  private func persistTranscript(_ sessionId: String) {
    guard let transcripts else { return }
    try? transcripts.save(sessionId: sessionId, events: eventsBySession[sessionId] ?? [])
  }

  public func processEventNotification(_ notification: SessionEventNotification) {
    let sessionId = notification.sessionId
    let eventDict = notification.event
    let type = eventDict["type"]?.stringValue ?? ""
    let seq = eventDict["seq"]?.intValue ?? 0
    let data = eventDict["data"] ?? .null
    if type == "user/message",
       eventDict["data"]?["source"]?["kind"]?.stringValue == "user" {
      let incoming = textOf(data["content"] ?? .null)
      let existing = (eventsBySession[sessionId] ?? []).reversed().first { $0.type == "user/message" }
      if let existing, textOf(existing.data["content"] ?? .null) == incoming {
        return
      }
    }
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
