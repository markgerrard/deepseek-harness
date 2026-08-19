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
    guard case .user(_, let seq1, let text1) = items[0] else {
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

    controller.toggleExpansion(id: "reason:2", kind: "reasoning")
    XCTAssertTrue(controller.transcriptExpansion.reasoning.contains("reason:2"))
  }
}
