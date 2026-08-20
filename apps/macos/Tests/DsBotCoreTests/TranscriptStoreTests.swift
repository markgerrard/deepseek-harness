import Foundation
import XCTest
@testable import DsBotCore

final class TranscriptStoreTests: XCTestCase {
  private func temporaryDirectory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("transcripts-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  func testHarnessProjectKeyMatchesDshLayout() {
    XCTAssertEqual(
      harnessProjectKey("/Users/mark/Library/Application Support/DsBot/workspace"),
      "--Users-mark-Library-Application~0020Support-DsBot-workspace--"
    )
  }

  func testSaveLoadRoundTrip() throws {
    let dir = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }
    let store = TranscriptStore(directory: dir)
    let events = [
      SessionEventDTO(
        type: "user/message",
        seq: 1,
        data: .object([
          "source": .object(["kind": .string("user")]),
          "content": .array([.object(["type": .string("text"), "text": .string("hello")])]),
        ])
      ),
      SessionEventDTO(
        type: "assistant/message",
        seq: 2,
        data: .object([
          "message": .object([
            "content": .array([.object(["type": .string("text"), "text": .string("hi there")])]),
          ]),
        ])
      ),
    ]
    try store.save(sessionId: "s1", events: events)
    XCTAssertEqual(store.load(sessionId: "s1"), events)
    XCTAssertEqual(TranscriptStore(directory: dir).load(sessionId: "s1"), events)
  }

  func testMissingSessionIsEmpty() throws {
    let dir = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }
    XCTAssertEqual(TranscriptStore(directory: dir).load(sessionId: "missing"), [])
  }

  func testImportPlainJsonlHarnessLog() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let workspace = root.appendingPathComponent("workspace")
    let dshHome = root.appendingPathComponent("dsh")
    let project = harnessProjectKey(workspace.path)
    let sessionDir = dshHome
      .appendingPathComponent("sessions")
      .appendingPathComponent(project)
      .appendingPathComponent(harnessEncodeSegment("sess-1"))
    try FileManager.default.createDirectory(at: sessionDir, withIntermediateDirectories: true)
    let jsonl = """
    {"type":"session","version":0,"id":"sess-1","createdAt":1,"cwd":"\(workspace.path)","delegationDepth":0}
    {"type":"user/message","seq":1,"time":2,"data":{"source":{"kind":"user"},"content":[{"type":"text","text":"hi"}]}}
    {"type":"assistant/message","seq":2,"time":3,"data":{"message":{"content":[{"type":"text","text":"hello"}]}}}
    """
    try jsonl.write(to: sessionDir.appendingPathComponent("session.jsonl"), atomically: true, encoding: .utf8)

    let store = TranscriptStore(directory: root.appendingPathComponent("tx"), workspace: workspace, dshHome: dshHome)
    let events = store.loadOrImport(sessionId: "sess-1")
    XCTAssertEqual(events.map(\.type), ["user/message", "assistant/message"])
    XCTAssertEqual(events[0].seq, 1)
    XCTAssertEqual(events[1].seq, 2)
  }

  @MainActor
  func testControllerReloadsPersistedTranscript() throws {
    let dir = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }
    let botsURL = dir.appendingPathComponent("bots.json")
    var bots = BotStore(fileURL: botsURL)
    try bots.addBot(Bot(id: "bot-a", displayName: "A", provider: "p", model: "m"))
    try bots.addThread(Thread(id: "s1", botID: "bot-a", title: "A"))
    let transcripts = TranscriptStore(directory: dir.appendingPathComponent("transcripts"))
    let client = HarnessClient(command: "/bin/echo", arguments: [], cwd: dir)
    let first = SessionController(client: client, store: bots, transcripts: transcripts)
    first.appendEvent(
      SessionEventDTO(
        type: "user/message",
        seq: 1,
        data: .object([
          "source": .object(["kind": .string("user")]),
          "content": .array([.object(["type": .string("text"), "text": .string("hello")])]),
        ])
      ),
      forSessionId: "s1"
    )
    first.appendEvent(
      SessionEventDTO(
        type: "assistant/message",
        seq: 2,
        data: .object([
          "message": .object([
            "content": .array([.object(["type": .string("text"), "text": .string("hi")])]),
          ]),
        ])
      ),
      forSessionId: "s1"
    )

    let second = SessionController(
      client: HarnessClient(command: "/bin/echo", arguments: [], cwd: dir),
      store: BotStore(fileURL: botsURL),
      transcripts: TranscriptStore(directory: dir.appendingPathComponent("transcripts"))
    )
    let items = second.transcript(for: "s1")
    XCTAssertEqual(items.count, 2)
    guard case .user(_, _, let user, _) = items[0] else { return XCTFail("expected user") }
    guard case .assistant(_, _, let asst, _) = items[1] else { return XCTFail("expected assistant") }
    XCTAssertEqual(user, "hello")
    XCTAssertEqual(asst, "hi")
  }
}
