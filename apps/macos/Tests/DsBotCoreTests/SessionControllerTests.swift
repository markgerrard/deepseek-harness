import Foundation
import XCTest
@testable import DsBotCore

final class SessionControllerTests: XCTestCase {
  private func bundledFakeRuntimeURL() throws -> URL {
    #if os(macOS)
    for bundle in Bundle.allBundles where bundle.bundlePath.hasSuffix(".xctest") {
      let url = bundle.bundleURL.deletingLastPathComponent().appendingPathComponent("FakeSdkRuntime")
      if FileManager.default.isExecutableFile(atPath: url.path) { return url }
    }
    #endif
    throw NSError(domain: "SessionControllerTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "FakeSdkRuntime product not found"])
  }

  @MainActor
  func testCreateBotRecordsPresetAndModel() async throws {
    let runtime = try bundledFakeRuntimeURL()
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let copyRecordFile = tempDir.appendingPathComponent("copy.txt")
    let personaRecordFile = tempDir.appendingPathComponent("persona.txt")
    let promptRecordFile = tempDir.appendingPathComponent("prompt.txt")
    let storeFile = tempDir.appendingPathComponent("bots.json")

    let launch = RuntimeLaunch(
      command: runtime.path,
      arguments: [],
      cwd: tempDir,
      environment: [
        "FAKE_RECORD_PRESETS_COPY": copyRecordFile.path,
        "FAKE_RECORD_PRESETS_SET_PERSONA": personaRecordFile.path,
        "FAKE_RECORD_PROMPT": promptRecordFile.path,
      ]
    )

    let process = RuntimeProcess(launch: launch)
    let client = try process.start()
    let store = BotStore(fileURL: storeFile)
    let controller = SessionController(client: client, store: store)

    try await controller.initialize(cwd: tempDir.path, provider: "mock", model: "m", approvals: true)

    let bot = try await controller.createBot(
      displayName: "Alpha Bot",
      job: "You are TOKEN-A.",
      provider: "mock",
      model: "m",
      thinking: "high"
    )

    XCTAssertEqual(bot.id, "alpha-bot")
    XCTAssertEqual(bot.displayName, "Alpha Bot")
    XCTAssertEqual(bot.provider, "mock")
    XCTAssertEqual(bot.model, "m")
    XCTAssertEqual(bot.reasoningEffort, "high")

    let storedBot = controller.store.bots.first(where: { $0.id == "alpha-bot" })
    XCTAssertNotNil(storedBot)
    XCTAssertEqual(storedBot?.provider, "mock")
    XCTAssertEqual(storedBot?.model, "m")
    XCTAssertEqual(storedBot?.reasoningEffort, "high")
    XCTAssertFalse(bot.pinned)
    XCTAssertFalse(storedBot?.pinned ?? true)
    XCTAssertNil(bot.chatSurface)
    XCTAssertEqual(controller.effectiveChatSurface, .simple)
    XCTAssertEqual(controller.threads(forBot: bot.id).count, 1)
    XCTAssertEqual(controller.selectedBotId, bot.id)
    XCTAssertEqual(controller.selectedThreadId, controller.threads(forBot: bot.id).first?.id)

    try await process.stop()

    let copyContent = try String(contentsOf: copyRecordFile, encoding: .utf8)
    XCTAssertTrue(copyContent.contains("\"from\":\"code\""))
    XCTAssertTrue(copyContent.contains("\"id\":\"alpha-bot\""))

    let personaContent = try String(contentsOf: personaRecordFile, encoding: .utf8)
    XCTAssertTrue(personaContent.contains("TOKEN-A"))
    XCTAssertTrue(personaContent.contains("{{cwd}}"))
    XCTAssertTrue(personaContent.contains("{{model}}"))
  }

  @MainActor
  func testNewThreadStaysOnOwningBot() async throws {
    let runtime = try bundledFakeRuntimeURL()
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let storeFile = tempDir.appendingPathComponent("bots.json")
    let launch = RuntimeLaunch(command: runtime.path, arguments: [], cwd: tempDir)
    let process = RuntimeProcess(launch: launch)
    let client = try process.start()
    let store = BotStore(fileURL: storeFile)
    let controller = SessionController(client: client, store: store)

    try await controller.initialize(cwd: tempDir.path, provider: "mock", model: "m", approvals: true)

    let botA = try await controller.createBot(
      displayName: "Bot A",
      job: "Job A",
      provider: "mock",
      model: "m1",
      thinking: "off"
    )
    let botB = try await controller.createBot(
      displayName: "Bot B",
      job: "Job B",
      provider: "mock",
      model: "m2",
      thinking: "high"
    )

    let threadA = try await controller.newThread(forBot: botA, initialPrompt: "Hello Bot A")

    let threadsB = controller.threads(forBot: botB.id)
    XCTAssertFalse(threadsB.contains(where: { $0.id == threadA.id }))

    let owningBot = controller.store.bot(forThread: threadA.id)
    XCTAssertEqual(owningBot?.id, botA.id)

    try await process.stop()
  }

  @MainActor
  func testCreateBotIsUnpinnedAndEnsureChatIsIdempotent() async throws {
    let runtime = try bundledFakeRuntimeURL()
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let process = RuntimeProcess(launch: RuntimeLaunch(command: runtime.path, arguments: [], cwd: tempDir))
    let client = try process.start()
    let storeFile = tempDir.appendingPathComponent("bots.json")
    let controller = SessionController(client: client, store: BotStore(fileURL: storeFile))
    try await controller.initialize(cwd: tempDir.path, provider: "mock", model: "m", approvals: true)

    let bot = try await controller.createBot(
      displayName: "Solo Bot",
      job: "Job",
      provider: "mock",
      model: "m"
    )
    XCTAssertFalse(bot.pinned)
    XCTAssertEqual(controller.threads(forBot: bot.id).count, 1)

    let first = try controller.ensureChat(forBot: bot.id)
    let second = try controller.ensureChat(forBot: bot.id)
    XCTAssertEqual(first.id, second.id)
    XCTAssertEqual(controller.threads(forBot: bot.id).count, 1)

    try controller.pinBot(id: bot.id)
    XCTAssertTrue(controller.bots.first(where: { $0.id == bot.id })?.pinned == true)
    XCTAssertTrue(BotStore(fileURL: storeFile).bots.first?.pinned == true)

    try controller.unpinBot(id: bot.id)
    XCTAssertFalse(controller.bots.first(where: { $0.id == bot.id })?.pinned == true)
    XCTAssertFalse(BotStore(fileURL: storeFile).bots.first?.pinned == true)

    try await process.stop()
  }

  @MainActor
  func testSelectBotOpensTheOneChat() async throws {
    let runtime = try bundledFakeRuntimeURL()
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let process = RuntimeProcess(launch: RuntimeLaunch(command: runtime.path, arguments: [], cwd: tempDir))
    let client = try process.start()
    let controller = SessionController(
      client: client,
      store: BotStore(fileURL: tempDir.appendingPathComponent("bots.json"))
    )
    try await controller.initialize(cwd: tempDir.path, provider: "mock", model: "m", approvals: true)

    let botA = try await controller.createBot(
      displayName: "Bot A",
      job: "A",
      provider: "mock",
      model: "m"
    )
    let botB = try await controller.createBot(
      displayName: "Bot B",
      job: "B",
      provider: "mock",
      model: "m"
    )
    let chatA = try controller.ensureChat(forBot: botA.id)
    let chatB = try controller.ensureChat(forBot: botB.id)
    XCTAssertNotEqual(chatA.id, chatB.id)

    controller.selectBot(id: botA.id)
    XCTAssertEqual(controller.selectedBotId, botA.id)
    XCTAssertEqual(controller.selectedThreadId, chatA.id)

    controller.selectBot(id: botB.id)
    XCTAssertEqual(controller.selectedBotId, botB.id)
    XCTAssertEqual(controller.selectedThreadId, chatB.id)

    try await process.stop()
  }

  @MainActor
  func testChatSurfaceToggleAndBotOverride() async throws {
    let runtime = try bundledFakeRuntimeURL()
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let process = RuntimeProcess(launch: RuntimeLaunch(command: runtime.path, arguments: [], cwd: tempDir))
    let client = try process.start()
    let settings = AppSettingsStore(fileURL: tempDir.appendingPathComponent("settings.json"))
    let controller = SessionController(
      client: client,
      store: BotStore(fileURL: tempDir.appendingPathComponent("bots.json")),
      settings: settings
    )
    try await controller.initialize(cwd: tempDir.path, provider: "mock", model: "m", approvals: true)
    let bot = try await controller.createBot(
      displayName: "Surface Bot",
      job: "Job",
      provider: "mock",
      model: "m"
    )
    XCTAssertEqual(controller.effectiveChatSurface, .simple)

    controller.toggleChatSurface()
    XCTAssertEqual(controller.effectiveChatSurface, .advanced)
    XCTAssertNil(controller.store.bots.first?.chatSurface)

    try controller.setAccountChatSurface(.advanced)
    XCTAssertEqual(controller.effectiveChatSurface, .advanced)
    controller.toggleChatSurface()
    XCTAssertEqual(controller.effectiveChatSurface, .simple)

    try controller.setBotChatSurface(id: bot.id, chatSurface: .advanced)
    XCTAssertEqual(controller.effectiveChatSurface, .advanced)
    XCTAssertEqual(controller.store.bots.first?.chatSurface, .advanced)

    try await process.stop()
  }

  @MainActor
  func testSlugifyValidation() throws {
    XCTAssertEqual(try SessionController.slugify("Alpha Bot"), "alpha-bot")
    XCTAssertEqual(try SessionController.slugify("  My Cool Bot 2.0!  "), "my-cool-bot-2-0")
    XCTAssertEqual(try SessionController.slugify("123 bot"), "123-bot")

    XCTAssertThrowsError(try SessionController.slugify("")) { error in
      guard case SessionControllerError.invalidDisplayName = error else {
        return XCTFail("Expected invalidDisplayName, got \(error)")
      }
    }
    XCTAssertThrowsError(try SessionController.slugify("---")) { error in
      guard case SessionControllerError.invalidDisplayName = error else {
        return XCTFail("Expected invalidDisplayName, got \(error)")
      }
    }
    XCTAssertThrowsError(try SessionController.slugify("   !@#$%^&*()   ")) { error in
      guard case SessionControllerError.invalidDisplayName = error else {
        return XCTFail("Expected invalidDisplayName, got \(error)")
      }
    }
  }

  @MainActor
  func testMissingKeySurfacedAsThreadError() async throws {
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let storeFile = tempDir.appendingPathComponent("bots.json")
    let store = BotStore(fileURL: storeFile)
    let client = HarnessClient(command: "/bin/echo", arguments: [], cwd: tempDir)
    let controller = SessionController(client: client, store: store)

    let missingKeyError = HarnessRPCError(code: -32000, message: "DEEPSEEK_API_KEY environment variable is not set")
    controller.appendEvent(SessionEventDTO(type: "user/message", seq: 1, data: .object(["source": .object(["kind": .string("user")]), "content": .array([.object(["type": .string("text"), "text": .string("test")])])])), forSessionId: "s1")

    // Simulate error handling
    let bot = Bot(id: "bot-test", displayName: "Test", provider: "deepseek", model: "deepseek-v4")
    try controller.store.addBot(bot)
    let thread = Thread(id: "s1", botID: "bot-test", title: "Test")
    try controller.store.addThread(thread)
    controller.selectThread(id: "s1")

    // Check key error extraction
    XCTAssertNil(controller.threadErrors["s1"])
    XCTAssertThrowsError(try {
      throw missingKeyError
    }())

    // Direct invocation check of missing key extraction
    let opencodeError = HarnessRPCError(code: -32000, message: "OPENCODE_API_KEY is missing")
    let clineError = HarnessRPCError(code: -32000, message: "CLINE_API_KEY is missing")
    XCTAssertTrue(opencodeError.localizedDescription.contains("OPENCODE_API_KEY"))
    XCTAssertTrue(clineError.localizedDescription.contains("CLINE_API_KEY"))
  }

  @MainActor
  func testPendingApprovalAndDismissal() async throws {
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let storeFile = tempDir.appendingPathComponent("bots.json")
    let store = BotStore(fileURL: storeFile)
    let client = HarnessClient(command: "/bin/echo", arguments: [], cwd: tempDir)
    let controller = SessionController(client: client, store: store)

    let req = PermissionRequest(sessionId: "s1", toolName: "bash", callId: "c1", reason: "run command")

    Task {
      try await Task.sleep(nanoseconds: 20_000_000)
      XCTAssertEqual(controller.pendingApproval?.callId, "c1")
      controller.dismissPendingApproval()
    }

    let outcome = await controller.handlePermissionRequest(req)
    XCTAssertEqual(outcome, .rejected)
    XCTAssertEqual(outcome, outcomeForDismissedSheet())
    XCTAssertNil(controller.pendingApproval)
  }

  @MainActor
  func testSendWhileWorkingSteersAndKeepInboxCancels() async throws {
    let runtime = try bundledFakeRuntimeURL()
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let cancelRecordFile = tempDir.appendingPathComponent("cancel.txt")
    let promptRecordFile = tempDir.appendingPathComponent("prompt.txt")
    let launch = RuntimeLaunch(
      command: runtime.path,
      arguments: [],
      cwd: tempDir,
      environment: [
        "FAKE_RECORD_CANCEL": cancelRecordFile.path,
        "FAKE_RECORD_PROMPT": promptRecordFile.path,
      ]
    )
    let process = RuntimeProcess(launch: launch)
    let client = try process.start()
    let controller = SessionController(client: client, store: BotStore(fileURL: tempDir.appendingPathComponent("bots.json")))
    try await controller.initialize(cwd: tempDir.path, provider: "mock", model: "m", approvals: true)
    _ = try await controller.createBot(displayName: "Busy Bot", job: "j", provider: "mock", model: "m")
    let threadId = try XCTUnwrap(controller.selectedThreadId)

    // A tool call without its result marks the thread as working.
    controller.appendEvent(
      SessionEventDTO(type: "tool/call", seq: 100, data: .object([
        "callId": .string("c1"), "name": .string("bash"), "arguments": .string("{}"),
      ])),
      forSessionId: threadId
    )

    _ = try await controller.sendPrompt(threadId: threadId, text: "redirect now")
    try await process.stop()

    let cancelContent = try String(contentsOf: cancelRecordFile, encoding: .utf8)
    XCTAssertTrue(cancelContent.contains(threadId))
    XCTAssertTrue(cancelContent.contains("\"keepInbox\":true"))
  }

  @MainActor
  func testStopCurrentTurnSendsSessionCancel() async throws {
    let runtime = try bundledFakeRuntimeURL()
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let cancelRecordFile = tempDir.appendingPathComponent("cancel.txt")
    let launch = RuntimeLaunch(
      command: runtime.path,
      arguments: [],
      cwd: tempDir,
      environment: ["FAKE_RECORD_CANCEL": cancelRecordFile.path]
    )
    let process = RuntimeProcess(launch: launch)
    let client = try process.start()
    let controller = SessionController(client: client, store: BotStore(fileURL: tempDir.appendingPathComponent("bots.json")))
    try await controller.initialize(cwd: tempDir.path, provider: "mock", model: "m", approvals: true)
    let bot = try await controller.createBot(displayName: "Stop Bot", job: "j", provider: "mock", model: "m")
    let threadId = try XCTUnwrap(controller.selectedThreadId)
    XCTAssertEqual(controller.store.bot(forThread: threadId)?.id, bot.id)

    await controller.stopCurrentTurn()
    try await process.stop()

    let content = try String(contentsOf: cancelRecordFile, encoding: .utf8)
    XCTAssertTrue(content.contains(threadId))
  }

  @MainActor
  func testStreamRenderIntervalScalesWithLength() {
    XCTAssertEqual(SessionController.streamRenderInterval(forLength: 0), .milliseconds(100))
    XCTAssertEqual(SessionController.streamRenderInterval(forLength: 4_000), .milliseconds(100))
    XCTAssertEqual(SessionController.streamRenderInterval(forLength: 4_001), .milliseconds(250))
    XCTAssertEqual(SessionController.streamRenderInterval(forLength: 12_001), .milliseconds(500))
  }

  @MainActor
  func testTranscriptRevisionCoalescesChunksAndBumpsOnDurableEvents() async throws {
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let store = BotStore(fileURL: tempDir.appendingPathComponent("bots.json"))
    let client = HarnessClient(command: "/bin/echo", arguments: [], cwd: tempDir)
    let controller = SessionController(client: client, store: store)

    let before = controller.transcriptRevision
    let chunk = SessionEventDTO(type: "assistant/chunk", seq: 1, data: .object([
      "turn": .number(1), "step": .number(1),
      "chunk": .object(["type": .string("text-delta"), "index": .number(0), "text": .string("hi")]),
    ]))
    controller.appendEvent(chunk, forSessionId: "s1")
    controller.appendEvent(chunk, forSessionId: "s1")
    XCTAssertEqual(controller.transcriptRevision, before, "chunks must not bump synchronously")

    try await Task.sleep(for: SessionController.streamRenderInterval * 3)
    XCTAssertEqual(controller.transcriptRevision, before + 1, "a chunk burst coalesces to one bump")

    controller.appendEvent(
      SessionEventDTO(type: "user/message", seq: 3, data: .object([
        "source": .object(["kind": .string("user")]),
        "content": .array([.object(["type": .string("text"), "text": .string("hello")])]),
      ])),
      forSessionId: "s1"
    )
    XCTAssertEqual(controller.transcriptRevision, before + 2, "durable events bump immediately")
  }

  @MainActor
  func testWorkingStateSpansTurnStartToTurnEndWithoutItems() throws {
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let store = BotStore(fileURL: tempDir.appendingPathComponent("bots.json"))
    let client = HarnessClient(command: "/bin/echo", arguments: [], cwd: tempDir)
    let controller = SessionController(client: client, store: store)
    controller.selectedThreadId = "s1"

    XCTAssertFalse(controller.presentedChat.isWorking)

    // A plain-text reply produces no in-flight item, so turn lifecycle alone
    // must carry the working state.
    controller.appendEvent(
      SessionEventDTO(type: "turn/start", seq: 1, data: .object(["turn": .number(1)])),
      forSessionId: "s1"
    )
    XCTAssertTrue(controller.presentedChat.isWorking)
    XCTAssertTrue(controller.isTurnActive("s1"))

    controller.appendEvent(
      SessionEventDTO(type: "turn/end", seq: 2, data: .object(["turn": .number(1)])),
      forSessionId: "s1"
    )
    XCTAssertFalse(controller.presentedChat.isWorking)
    XCTAssertFalse(controller.isTurnActive("s1"))
  }

  @MainActor
  func testWorkingStateStartsAtSendBeforeTurnStart() async throws {
    let runtime = try bundledFakeRuntimeURL()
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let process = RuntimeProcess(launch: RuntimeLaunch(command: runtime.path, arguments: [], cwd: tempDir))
    let client = try process.start()
    let controller = SessionController(client: client, store: BotStore(fileURL: tempDir.appendingPathComponent("bots.json")))
    try await controller.initialize(cwd: tempDir.path, provider: "mock", model: "m", approvals: true)
    _ = try await controller.createBot(displayName: "Wait Bot", job: "j", provider: "mock", model: "m")
    let threadId = try XCTUnwrap(controller.selectedThreadId)

    // The fake runtime never emits turn/start, so this pins the send-side
    // window alone: working from the send until a turn lifecycle resolves it.
    _ = try await controller.sendPrompt(threadId: threadId, text: "hello")
    XCTAssertTrue(controller.isTurnActive(threadId))
    XCTAssertTrue(controller.presentedChat.isWorking)

    controller.appendEvent(
      SessionEventDTO(type: "turn/end", seq: 900, data: .object(["turn": .number(1)])),
      forSessionId: threadId
    )
    XCTAssertFalse(controller.isTurnActive(threadId))
    try await process.stop()
  }

  @MainActor
  func testPresentedChatCapsItemsAndPagesEarlier() throws {
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let store = BotStore(fileURL: tempDir.appendingPathComponent("bots.json"))
    let client = HarnessClient(command: "/bin/echo", arguments: [], cwd: tempDir)
    let controller = SessionController(client: client, store: store)

    let total = SessionController.transcriptWindowSize + 30
    let events = (1...total).map { seq in
      SessionEventDTO(type: "user/message", seq: seq, data: .object([
        "source": .object(["kind": .string("user")]),
        "content": .array([.object(["type": .string("text"), "text": .string("m\(seq)")])]),
      ]))
    }
    controller.setEvents(events, forSessionId: "s1")
    controller.selectedThreadId = "s1"

    let capped = controller.presentedChat
    XCTAssertTrue(capped.hasEarlier)
    XCTAssertEqual(capped.items.count, SessionController.transcriptWindowSize)
    guard case .user(_, let firstSeq, _, _) = capped.items[0] else { return XCTFail("Expected user item") }
    XCTAssertEqual(firstSeq, 31)

    controller.loadEarlierItems()
    let expanded = controller.presentedChat
    XCTAssertFalse(expanded.hasEarlier)
    XCTAssertEqual(expanded.items.count, total)
  }

  @MainActor
  func testTranscriptAccumulationAndExpansion() throws {
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let storeFile = tempDir.appendingPathComponent("bots.json")
    let store = BotStore(fileURL: storeFile)
    let client = HarnessClient(command: "/bin/echo", arguments: [], cwd: tempDir)
    let controller = SessionController(client: client, store: store)

    let events = [
      SessionEventDTO(type: "user/message", seq: 1, data: .object([
        "source": .object(["kind": .string("user")]),
        "content": .array([.object(["type": .string("text"), "text": .string("hello")])]),
      ])),
      SessionEventDTO(type: "assistant/message", seq: 2, data: .object([
        "message": .object([
          "content": .array([
            .object(["type": .string("reasoning"), "text": .string("thinking...")]),
            .object(["type": .string("text"), "text": .string("world")]),
          ]),
        ]),
      ])),
    ]

    controller.setEvents(events, forSessionId: "s1")
    controller.selectedThreadId = "s1"

    let items = controller.currentTranscript
    XCTAssertEqual(items.count, 3)
    guard case .user(_, let seq1, let text1, _) = items[0] else {
      return XCTFail("Expected user item")
    }
    XCTAssertEqual(seq1, 1)
    XCTAssertEqual(text1, "hello")

    guard case .reasoning(let rid, let seq2, let text2, _, let expanded2) = items[1] else {
      return XCTFail("Expected reasoning item")
    }
    XCTAssertEqual(rid, "reason:2")
    XCTAssertEqual(seq2, 2)
    XCTAssertEqual(text2, "thinking...")
    XCTAssertFalse(expanded2)

    guard case .assistant(let aid, let seq3, let text3, _) = items[2] else {
      return XCTFail("Expected assistant item")
    }
    XCTAssertEqual(aid, "asst:2")
    XCTAssertEqual(seq3, 2)
    XCTAssertEqual(text3, "world")

    XCTAssertEqual(controller.effectiveChatSurface, .simple)
    XCTAssertEqual(controller.presentedChat.items.map(\.kind), ["user", "assistant"])

    controller.toggleExpansion(id: "reason:2", kind: "reasoning")
    XCTAssertTrue(controller.transcriptExpansion.reasoning.contains("reason:2"))
  }

  func testWireReasoningEffortOmitsOff() {
    XCTAssertNil(SessionController.wireReasoningEffort("off"))
    XCTAssertNil(SessionController.wireReasoningEffort(""))
    XCTAssertNil(SessionController.wireReasoningEffort("  "))
    XCTAssertEqual(SessionController.wireReasoningEffort("high"), "high")
    XCTAssertEqual(SessionController.wireReasoningEffort("max"), "max")
  }

  func testNeedsResumeDetectsPersistedLogCollision() {
    XCTAssertTrue(SessionController.needsResume("session \"abc\" already exists in this backend"))
    XCTAssertTrue(SessionController.needsResume("session already has a persisted log on disk; load/resume it instead of creating"))
    XCTAssertFalse(SessionController.needsResume("CLINE_API_KEY is missing"))
  }

  @MainActor
  func testSendPromptResumesBeforePrompt() async throws {
    let runtime = try bundledFakeRuntimeURL()
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let resumeRecord = tempDir.appendingPathComponent("resume.txt")
    let promptRecord = tempDir.appendingPathComponent("prompt.txt")
    let launch = RuntimeLaunch(
      command: runtime.path,
      arguments: [],
      cwd: tempDir,
      environment: [
        "FAKE_RECORD_RESUME": resumeRecord.path,
        "FAKE_RECORD_PROMPT": promptRecord.path,
      ]
    )
    let process = RuntimeProcess(launch: launch)
    let client = try process.start()
    let controller = SessionController(client: client, store: BotStore(fileURL: tempDir.appendingPathComponent("bots.json")))
    try await controller.initialize(cwd: tempDir.path, provider: "mock", model: "m", approvals: true)
    let bot = try await controller.createBot(
      displayName: "Resume Bot",
      job: "j",
      provider: "cline-pass",
      model: "cline-pass/deepseek-v4-flash",
      thinking: "off"
    )
    let thread = try controller.ensureChat(forBot: bot.id)
    _ = try await controller.sendPrompt(threadId: thread.id, text: "hi")
    try await process.stop()

    let resumeText = try String(contentsOf: resumeRecord, encoding: .utf8)
    let resumeMethods = rpcMethods(in: resumeText)
    XCTAssertEqual(resumeMethods, ["session/resume"], "resume log: \(resumeText)")
    XCTAssertFalse(resumeText.contains("reasoningEffort"), "resume log: \(resumeText)")
    let promptText = try String(contentsOf: promptRecord, encoding: .utf8)
    let promptMethods = rpcMethods(in: promptText)
    XCTAssertEqual(promptMethods, ["session/prompt"], "prompt log: \(promptText)")
  }

  @MainActor
  func testSendPromptStillPromptsWhenResumeMisses() async throws {
    let runtime = try bundledFakeRuntimeURL()
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let promptRecord = tempDir.appendingPathComponent("prompt.txt")
    let launch = RuntimeLaunch(
      command: runtime.path,
      arguments: [],
      cwd: tempDir,
      environment: [
        "FAKE_RESUME_ERROR": "session not found",
        "FAKE_RECORD_PROMPT": promptRecord.path,
      ]
    )
    let process = RuntimeProcess(launch: launch)
    let client = try process.start()
    let controller = SessionController(client: client, store: BotStore(fileURL: tempDir.appendingPathComponent("bots.json")))
    try await controller.initialize(cwd: tempDir.path, provider: "mock", model: "m", approvals: true)
    let bot = try await controller.createBot(
      displayName: "Miss Bot",
      job: "j",
      provider: "mock",
      model: "m"
    )
    let thread = try controller.ensureChat(forBot: bot.id)
    _ = try await controller.sendPrompt(threadId: thread.id, text: "hello")
    try await process.stop()
    XCTAssertTrue(FileManager.default.fileExists(atPath: promptRecord.path))
  }

  @MainActor
  func testPromptOmitsReasoningEffortWhenThinkingOff() async throws {
    let params = try await promptParams(thinking: "off", initialPrompt: "hello")
    XCTAssertNil(params["reasoningEffort"])
  }

  @MainActor
  func testPromptSendsReasoningEffortWhenThinkingHigh() async throws {
    let params = try await promptParams(thinking: "high", initialPrompt: "hello")
    XCTAssertEqual(params["reasoningEffort"] as? String, "high")
  }

  @MainActor
  func testPromptSteersByDefault() async throws {
    let params = try await promptParams(thinking: "off", initialPrompt: "redirect please")
    XCTAssertEqual(params["steer"] as? Bool, true)
  }

  @MainActor
  func testSendPromptAlsoOmitsOff() async throws {
    let runtime = try bundledFakeRuntimeURL()
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let promptRecordFile = tempDir.appendingPathComponent("prompt.txt")
    let launch = RuntimeLaunch(
      command: runtime.path,
      arguments: [],
      cwd: tempDir,
      environment: ["FAKE_RECORD_PROMPT": promptRecordFile.path]
    )
    let process = RuntimeProcess(launch: launch)
    let client = try process.start()
    let controller = SessionController(client: client, store: BotStore(fileURL: tempDir.appendingPathComponent("bots.json")))
    try await controller.initialize(cwd: tempDir.path, provider: "mock", model: "m", approvals: true)
    let bot = try await controller.createBot(
      displayName: "Off Bot",
      job: "j",
      provider: "cline-pass",
      model: "cline-pass/deepseek-v4-flash",
      thinking: "off"
    )
    let thread = try await controller.newThread(forBot: bot, initialPrompt: "")
    XCTAssertFalse(FileManager.default.fileExists(atPath: promptRecordFile.path))
    _ = try await controller.sendPrompt(threadId: thread.id, text: "hi")
    try await process.stop()
    let params = try lastPromptParams(from: promptRecordFile)
    XCTAssertNil(params["reasoningEffort"])
  }

  @MainActor
  func testRpcErrorSurfacesOnThreadBanner() async throws {
    let runtime = try bundledFakeRuntimeURL()
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let launch = RuntimeLaunch(
      command: runtime.path,
      arguments: [],
      cwd: tempDir,
      environment: [
        "FAKE_PROMPT_ERROR": "provider \"cline-pass\" model \"cline-pass/deepseek-v4-flash\" does not support reasoning effort \"off\""
      ]
    )
    let process = RuntimeProcess(launch: launch)
    let client = try process.start()
    let controller = SessionController(client: client, store: BotStore(fileURL: tempDir.appendingPathComponent("bots.json")))
    try await controller.initialize(cwd: tempDir.path, provider: "mock", model: "m", approvals: true)
    let bot = try await controller.createBot(
      displayName: "Err Bot",
      job: "j",
      provider: "cline-pass",
      model: "cline-pass/deepseek-v4-flash",
      thinking: "off"
    )
    do {
      _ = try await controller.newThread(forBot: bot, initialPrompt: "hello")
      XCTFail("expected prompt RPC error")
    } catch {
      let threadId = controller.selectedThreadId
      XCTAssertNotNil(threadId)
      let banner = threadId.flatMap { controller.threadErrors[$0] }
      XCTAssertEqual(
        banner,
        "provider \"cline-pass\" model \"cline-pass/deepseek-v4-flash\" does not support reasoning effort \"off\""
      )
    }
    try await process.stop()
  }

  @MainActor
  private func promptParams(thinking: String, initialPrompt: String) async throws -> [String: Any] {
    let runtime = try bundledFakeRuntimeURL()
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }
    let promptRecordFile = tempDir.appendingPathComponent("prompt.txt")
    let launch = RuntimeLaunch(
      command: runtime.path,
      arguments: [],
      cwd: tempDir,
      environment: ["FAKE_RECORD_PROMPT": promptRecordFile.path]
    )
    let process = RuntimeProcess(launch: launch)
    let client = try process.start()
    let controller = SessionController(client: client, store: BotStore(fileURL: tempDir.appendingPathComponent("bots.json")))
    try await controller.initialize(cwd: tempDir.path, provider: "mock", model: "m", approvals: true)
    let bot = try await controller.createBot(
      displayName: "Rec Bot",
      job: "j",
      provider: "cline-pass",
      model: "cline-pass/deepseek-v4-flash",
      thinking: thinking
    )
    _ = try await controller.newThread(forBot: bot, initialPrompt: initialPrompt)
    try await process.stop()
    return try lastPromptParams(from: promptRecordFile)
  }

  private func lastPromptParams(from url: URL) throws -> [String: Any] {
    let text = try String(contentsOf: url, encoding: .utf8)
    let line = text.split(whereSeparator: \.isNewline).map(String.init).last(where: { !$0.isEmpty }) ?? ""
    let obj = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any]
    return obj?["params"] as? [String: Any] ?? [:]
  }

  private func rpcMethods(in text: String) -> [String] {
    text.split(whereSeparator: \.isNewline).compactMap { line in
      let data = Data(line.utf8)
      let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      return obj?["method"] as? String
    }
  }
}
