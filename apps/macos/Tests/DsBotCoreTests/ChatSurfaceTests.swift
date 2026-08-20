import Foundation
import XCTest
@testable import DsBotCore

final class ChatSurfaceTests: XCTestCase {
  func testResolvesSessionThenBotThenAccount() {
    XCTAssertEqual(
      resolvedChatSurface(account: .simple, bot: nil, session: nil),
      .simple
    )
    XCTAssertEqual(
      resolvedChatSurface(account: .simple, bot: .advanced, session: nil),
      .advanced
    )
    XCTAssertEqual(
      resolvedChatSurface(account: .advanced, bot: .simple, session: .advanced),
      .advanced
    )
    XCTAssertEqual(
      resolvedChatSurface(account: .advanced, bot: nil, session: nil),
      .advanced
    )
  }

  func testSimpleHidesThinkingAndToolInternals() {
    let items: [TranscriptItem] = [
      .user(id: "user:1", seq: 1, text: "hi"),
      .reasoning(id: "reason:2", seq: 2, text: "hmm", streaming: false, expanded: false),
      .tool(
        id: "tool:c1",
        seq: 3,
        callId: "c1",
        name: "bash",
        args: "{}",
        result: "ok",
        status: .success,
        expanded: false
      ),
      .command(id: "cmd:4", seq: 4, text: "ls"),
      .workflow(
        id: "workflow:r1",
        seq: 5,
        runId: "r1",
        name: "review",
        status: .success,
        members: [],
        expanded: false
      ),
      .assistant(id: "asst:6", seq: 6, text: "done", streaming: false),
    ]

    let presented = presentChat(items: items, surface: .simple)
    XCTAssertEqual(presented.items.map(\.kind), ["user", "assistant"])
    XCTAssertEqual(presented.items, [
      .user(id: "user:1", seq: 1, text: "hi"),
      .assistant(id: "asst:6", seq: 6, text: "done", streaming: false),
    ])
    XCTAssertFalse(presented.isWorking)
  }

  func testSimpleShowsWorkingWhileToolsOrThinkingRun() {
    let running: [TranscriptItem] = [
      .user(id: "user:1", seq: 1, text: "do it"),
      .reasoning(id: "reason:2", seq: 2, text: "plan", streaming: true, expanded: false),
      .tool(
        id: "tool:c1",
        seq: 3,
        callId: "c1",
        name: "bash",
        args: "{}",
        result: nil,
        status: .running,
        expanded: false
      ),
    ]
    let presented = presentChat(items: running, surface: .simple)
    XCTAssertEqual(presented.items.map(\.kind), ["user"])
    XCTAssertTrue(presented.isWorking)
    XCTAssertEqual(presented.activityLabel, "Running a command")
  }

  func testSimpleWorkingLabelForWebSearch() {
    let items: [TranscriptItem] = [
      .user(id: "user:1", seq: 1, text: "check"),
      .tool(
        id: "tool:c1",
        seq: 2,
        callId: "c1",
        name: "web_search",
        args: "{}",
        result: nil,
        status: .running,
        expanded: false
      ),
    ]
    let presented = presentChat(items: items, surface: .simple)
    XCTAssertTrue(presented.isWorking)
    XCTAssertEqual(presented.activityLabel, "Searching the web")
    XCTAssertEqual(presented.items.map(\.kind), ["user"])
  }

  func testSimpleSurfacesWriteResultAsArtifact() {
    let items: [TranscriptItem] = [
      .user(id: "user:1", seq: 1, text: "write it"),
      .tool(
        id: "tool:c1",
        seq: 2,
        callId: "c1",
        name: "write",
        args: #"{"path":"uploads/notes.md"}"#,
        result: "wrote 12 bytes",
        status: .success,
        expanded: false
      ),
      .assistant(id: "asst:3", seq: 3, text: "saved", streaming: false),
    ]
    let presented = presentChat(items: items, surface: .simple)
    XCTAssertEqual(presented.items.map(\.kind), ["user", "artifact", "assistant"])
    XCTAssertEqual(presented.items[1], .artifact(
      id: "artifact:tool:c1",
      seq: 2,
      name: "notes.md",
      path: "uploads/notes.md"
    ))
  }

  func testAdvancedKeepsInternals() {
    let items: [TranscriptItem] = [
      .reasoning(id: "reason:1", seq: 1, text: "hmm", streaming: false, expanded: false),
      .assistant(id: "asst:2", seq: 2, text: "ok", streaming: false),
    ]
    let presented = presentChat(items: items, surface: .advanced)
    XCTAssertEqual(presented.items, items)
    XCTAssertFalse(presented.isWorking)
  }
}
