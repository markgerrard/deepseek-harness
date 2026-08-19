import Foundation
import XCTest
@testable import DsBotCore

final class TranscriptProjectionTests: XCTestCase {
  private func event(_ type: String, _ seq: Int, _ data: [String: JSONValue]) -> SessionEventDTO {
    SessionEventDTO(type: type, seq: seq, data: .object(data))
  }

  func testJoinsTextBlocksAndFoldsLastTitleAndModel() {
    let content: [JSONValue] = [
      .object(["type": .string("text"), "text": .string("a")]),
      .object(["type": .string("text"), "text": .string("b")]),
    ]
    XCTAssertEqual(textOf(content), "ab")

    let contentBlocks = [
      ContentBlock(type: "text", text: "a"),
      ContentBlock(type: "text", text: "b"),
    ]
    XCTAssertEqual(textOf(contentBlocks), "ab")

    let titleEvents = [
      event("session/title", 1, ["title": .string("first")]),
      event("session/title", 2, ["title": .string("last")]),
    ]
    XCTAssertEqual(foldSessionTitle(titleEvents), "last")

    let modelEvents = [
      event("request/header", 1, [
        "header": .object([
          "config": .object([
            "provider": .string("p"),
            "model": .string("m"),
          ]),
        ]),
      ]),
    ]
    XCTAssertEqual(foldRequestModel(modelEvents), RequestModelInfo(provider: "p", model: "m"))
  }

  func testKeepsHumanUserRowsAndOmitsPluginSources() {
    let events = [
      event("user/message", 1, [
        "source": .object(["kind": .string("user")]),
        "content": .array([.object(["type": .string("text"), "text": .string("hello")])]),
      ]),
      event("user/message", 2, [
        "source": .object(["kind": .string("plugin")]),
        "content": .array([.object(["type": .string("text"), "text": .string("hidden")])]),
      ]),
    ]
    let items = projectTranscript(events)
    XCTAssertEqual(items, [
      .user(id: "user:1", seq: 1, text: "hello"),
    ])
  }

  func testFoldsStreamingChunksUntilAssistantMessageLands() {
    let streamingEvents = [
      event("assistant/chunk", 1, [
        "turn": .number(1),
        "step": .number(1),
        "chunk": .object([
          "type": .string("text-delta"),
          "index": .number(0),
          "text": .string("Hel"),
        ]),
      ]),
      event("assistant/chunk", 2, [
        "turn": .number(1),
        "step": .number(1),
        "chunk": .object([
          "type": .string("reasoning-delta"),
          "index": .number(1),
          "text": .string("hmm"),
        ]),
      ]),
    ]
    let streaming = projectTranscript(streamingEvents)
    XCTAssertEqual(streaming.map(\.kind), ["reasoning", "assistant"])
    XCTAssertEqual(streaming, [
      .reasoning(id: "reason:stream:1:1", seq: Int.max - 1, text: "hmm", streaming: true, expanded: false),
      .assistant(id: "asst:stream:1:1", seq: Int.max, text: "Hel", streaming: true),
    ])

    let landedEvents = [
      event("assistant/chunk", 1, [
        "turn": .number(1),
        "step": .number(1),
        "chunk": .object([
          "type": .string("text-delta"),
          "index": .number(0),
          "text": .string("Hel"),
        ]),
      ]),
      event("assistant/message", 2, [
        "message": .object([
          "content": .array([
            .object(["type": .string("text"), "text": .string("Hello")]),
          ]),
        ]),
      ]),
    ]
    let landed = projectTranscript(landedEvents)
    XCTAssertEqual(landed, [
      .assistant(id: "asst:2", seq: 2, text: "Hello", streaming: false),
    ])
  }

  func testToolCallThenResultIsSuccessCard() {
    let events = [
      event("tool/call", 1, [
        "callId": .string("c1"),
        "name": .string("bash"),
        "arguments": .string("{\"cmd\":\"ls\"}"),
      ]),
      event("tool/result", 2, [
        "message": .object([
          "source": .object(["kind": .string("tool"), "callId": .string("c1")]),
          "content": .array([.object(["type": .string("text"), "text": .string("ok")])]),
        ]),
        "meta": .object([
          "oldText": .string("a"),
          "newText": .string("b"),
        ]),
      ]),
    ]
    let expansion = TranscriptExpansion(tools: ["tool:c1"], reasoning: [], workflows: [])
    let items = projectTranscript(events, expansion: expansion)

    XCTAssertEqual(items.count, 1)
    guard case .tool(let id, let seq, let callId, let name, let args, let result, let status, let expanded, let meta) = items[0] else {
      return XCTFail("Expected tool item, got \(items[0])")
    }
    XCTAssertEqual(id, "tool:c1")
    XCTAssertEqual(seq, 1)
    XCTAssertEqual(callId, "c1")
    XCTAssertEqual(name, "bash")
    XCTAssertEqual(args, "{\"cmd\":\"ls\"}")
    XCTAssertEqual(result, "ok")
    XCTAssertEqual(status, .success)
    XCTAssertTrue(expanded)
    XCTAssertEqual(meta, .object(["oldText": .string("a"), "newText": .string("b")]))
  }

  func testTogglesExpansionIdsImmutably() {
    let empty: Set<String> = []
    let added = toggleId(empty, id: "x")
    XCTAssertTrue(added.contains("x"))
    let removed = toggleId(added, id: "x")
    XCTAssertFalse(removed.contains("x"))
  }

  func testProjectsWorkflowRun() {
    let events = [
      event("tool-workflow/run-start", 1, ["runId": .string("run-1"), "name": .string("review")]),
      event("tool-workflow/agent-start", 2, ["runId": .string("run-1"), "seq": .number(1), "label": .string("researcher"), "phase": .string("scan"), "childId": .string("child-1")]),
      event("tool-workflow/agent-end", 3, ["runId": .string("run-1"), "seq": .number(1), "outcome": .string("completed")]),
      event("tool-workflow/agent-start", 4, ["runId": .string("run-1"), "seq": .number(2), "label": .string("writer"), "childId": .string("child-2")]),
      event("tool-workflow/agent-end", 5, ["runId": .string("run-1"), "seq": .number(2), "outcome": .string("failed")]),
      event("tool-workflow/run-end", 6, ["runId": .string("run-1"), "stopReason": .string("error")]),
    ]
    let expansion = TranscriptExpansion(tools: [], reasoning: [], workflows: ["workflow:run-1"])
    let items = projectTranscript(events, expansion: expansion)

    XCTAssertEqual(items, [
      .workflow(
        id: "workflow:run-1",
        seq: 1,
        runId: "run-1",
        name: "review",
        status: .error,
        members: [
          WorkflowMember(seq: 1, label: "researcher", phase: "scan", status: .success),
          WorkflowMember(seq: 2, label: "writer", phase: nil, status: .error),
        ],
        expanded: true
      ),
    ])
  }
}
