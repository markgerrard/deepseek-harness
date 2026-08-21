import Foundation

public struct SessionEventDTO: Codable, Equatable, Sendable {
  public var type: String
  public var seq: Int
  public var data: JSONValue

  public init(type: String, seq: Int, data: JSONValue) {
    self.type = type
    self.seq = seq
    self.data = data
  }
}

public enum ToolCardStatus: String, Codable, Equatable, Sendable {
  case running
  case success
  case error
  case awaiting
}

public enum WorkflowStatus: String, Codable, Equatable, Sendable {
  case running
  case success
  case error
}

public struct WorkflowMember: Codable, Equatable, Sendable {
  public var seq: Int
  public var label: String
  public var phase: String?
  public var status: WorkflowStatus

  public init(seq: Int, label: String, phase: String? = nil, status: WorkflowStatus) {
    self.seq = seq
    self.label = label
    self.phase = phase
    self.status = status
  }
}

public enum TranscriptItem: Equatable, Sendable, Identifiable {
  case user(id: String, seq: Int, text: String, attachments: [ChatAttachment] = [])
  case assistant(id: String, seq: Int, text: String, streaming: Bool)
  case reasoning(id: String, seq: Int, text: String, streaming: Bool, expanded: Bool)
  case tool(
    id: String,
    seq: Int,
    callId: String,
    name: String,
    args: String,
    result: String?,
    status: ToolCardStatus,
    expanded: Bool,
    meta: JSONValue? = nil
  )
  case command(id: String, seq: Int, text: String)
  case workflow(
    id: String,
    seq: Int,
    runId: String,
    name: String,
    status: WorkflowStatus,
    members: [WorkflowMember],
    expanded: Bool
  )
  case artifact(id: String, seq: Int, name: String, path: String)

  public var id: String {
    switch self {
    case .user(let id, _, _, _): return id
    case .assistant(let id, _, _, _): return id
    case .reasoning(let id, _, _, _, _): return id
    case .tool(let id, _, _, _, _, _, _, _, _): return id
    case .command(let id, _, _): return id
    case .workflow(let id, _, _, _, _, _, _): return id
    case .artifact(let id, _, _, _): return id
    }
  }

  public var seq: Int {
    switch self {
    case .user(_, let seq, _, _): return seq
    case .assistant(_, let seq, _, _): return seq
    case .reasoning(_, let seq, _, _, _): return seq
    case .tool(_, let seq, _, _, _, _, _, _, _): return seq
    case .command(_, let seq, _): return seq
    case .workflow(_, let seq, _, _, _, _, _): return seq
    case .artifact(_, let seq, _, _): return seq
    }
  }

  public var kind: String {
    switch self {
    case .user: return "user"
    case .assistant: return "assistant"
    case .reasoning: return "reasoning"
    case .tool: return "tool"
    case .command: return "command"
    case .workflow: return "workflow"
    case .artifact: return "artifact"
    }
  }
}

public struct TranscriptExpansion: Equatable, Sendable {
  public var tools: Set<String>
  public var reasoning: Set<String>
  public var workflows: Set<String>

  public init(
    tools: Set<String> = [],
    reasoning: Set<String> = [],
    workflows: Set<String> = []
  ) {
    self.tools = tools
    self.reasoning = reasoning
    self.workflows = workflows
  }
}

public struct RequestModelInfo: Equatable, Sendable {
  public var provider: String
  public var model: String

  public init(provider: String, model: String) {
    self.provider = provider
    self.model = model
  }
}

extension JSONValue {
  public subscript(key: String) -> JSONValue? {
    if case .object(let dict) = self {
      return dict[key]
    }
    return nil
  }

  public subscript(index: Int) -> JSONValue? {
    if case .array(let arr) = self, index >= 0 && index < arr.count {
      return arr[index]
    }
    return nil
  }

  public var stringValue: String? {
    if case .string(let str) = self { return str }
    return nil
  }

  public var intValue: Int? {
    if case .number(let num) = self { return Int(num) }
    return nil
  }

  public var doubleValue: Double? {
    if case .number(let num) = self { return num }
    return nil
  }

  public var boolValue: Bool? {
    if case .bool(let b) = self { return b }
    return nil
  }

  public var arrayValue: [JSONValue]? {
    if case .array(let arr) = self { return arr }
    return nil
  }

  public var objectValue: [String: JSONValue]? {
    if case .object(let obj) = self { return obj }
    return nil
  }
}

public func textOf(_ content: [ContentBlock]) -> String {
  content.compactMap { block in
    block.type == "text" ? (block.text ?? "") : nil
  }.joined()
}

public func textOf(_ content: [JSONValue]) -> String {
  content.compactMap { block in
    if case .object(let dict) = block,
       dict["type"]?.stringValue == "text" {
      return dict["text"]?.stringValue ?? ""
    }
    return nil
  }.joined()
}

public func textOf(_ content: JSONValue) -> String {
  if case .array(let array) = content {
    return textOf(array)
  }
  return ""
}

public func foldSessionTitle(_ events: [SessionEventDTO]) -> String? {
  for event in events.reversed() {
    if event.type == "session/title" {
      return event.data["title"]?.stringValue
    }
  }
  return nil
}

public func foldRequestModel(_ events: [SessionEventDTO]) -> RequestModelInfo? {
  for event in events.reversed() {
    if event.type == "request/header" {
      if let provider = event.data["header"]?["config"]?["provider"]?.stringValue,
         let model = event.data["header"]?["config"]?["model"]?.stringValue {
        return RequestModelInfo(provider: provider, model: model)
      }
    }
  }
  return nil
}

public func toggleId(_ current: Set<String>, id: String) -> Set<String> {
  var next = current
  if next.contains(id) {
    next.remove(id)
  } else {
    next.insert(id)
  }
  return next
}

private struct ChunkBuffer {
  var text: String = ""
  var reasoning: String = ""
}

private struct StreamingTurn {
  var turn: Int
  var step: Int
}

private struct OpenTool {
  var seq: Int
  var name: String
  var args: String
}

/**
 Incremental fold of session events into transcript items.

 `ingest` consumes one event and updates the folded item list in place, so a
 streaming chunk costs one buffer update instead of a full reprojection.
 `materialize` returns the presentable items: the folded list with the given
 expansion flags applied plus the in-flight streaming tail. Folded items are
 stored collapsed; expansion is a materialize-time overlay, so toggling a card
 never requires refolding events.
 */
public struct TranscriptProjector: Sendable {
  private var items: [TranscriptItem] = []
  private var indexById: [String: Int] = [:]
  private var chunkBuffers: [Int: ChunkBuffer] = [:]
  private var openTools: [String: OpenTool] = [:]
  private var openWorkflows: [String: TranscriptItem] = [:]
  private var streamingTurn: StreamingTurn?

  public init() {}

  private mutating func append(_ item: TranscriptItem) {
    indexById[item.id] = items.count
    items.append(item)
  }

  private mutating func upsert(_ item: TranscriptItem) {
    if let index = indexById[item.id] {
      items[index] = item
    } else {
      append(item)
    }
  }

  /// Fold one session event into the projected items.
  /// - Parameter event: the durable session event, in seq order.
  public mutating func ingest(_ event: SessionEventDTO) {
    switch event.type {
    case "user/message":
      guard event.data["source"]?["kind"]?.stringValue == "user" else { break }
      let text = textOf(event.data["content"] ?? .null).trimmingCharacters(in: .whitespacesAndNewlines)
      let attachments = ChatAttachment.list(from: event.data["attachments"])
      guard !text.isEmpty || !attachments.isEmpty else { break }
      append(.user(id: "user:\(event.seq)", seq: event.seq, text: text, attachments: attachments))

    case "assistant/chunk":
      let turn = event.data["turn"]?.intValue ?? 0
      let step = event.data["step"]?.intValue ?? 0
      streamingTurn = StreamingTurn(turn: turn, step: step)
      if let chunk = event.data["chunk"] {
        let chunkType = chunk["type"]?.stringValue
        let index = chunk["index"]?.intValue ?? 0
        var current = chunkBuffers[index] ?? ChunkBuffer()
        if chunkType == "text-delta" {
          current.text += chunk["text"]?.stringValue ?? ""
          chunkBuffers[index] = current
        } else if chunkType == "reasoning-delta" {
          current.reasoning += chunk["text"]?.stringValue ?? ""
          chunkBuffers[index] = current
        } else if chunkType == "block-start" {
          chunkBuffers[index] = current
        }
      }

    case "assistant/message":
      streamingTurn = nil
      chunkBuffers.removeAll()
      if let content = event.data["message"]?["content"]?.arrayValue {
        for block in content {
          let blockType = block["type"]?.stringValue
          let blockText = block["text"]?.stringValue ?? ""
          if blockType == "reasoning" && !blockText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            append(.reasoning(
              id: "reason:\(event.seq)",
              seq: event.seq,
              text: blockText,
              streaming: false,
              expanded: false
            ))
          }
          if blockType == "text" && !blockText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            append(.assistant(
              id: "asst:\(event.seq)",
              seq: event.seq,
              text: blockText,
              streaming: false
            ))
          }
        }
      }

    case "tool/call":
      let callId = event.data["callId"]?.stringValue ?? ""
      let name = event.data["name"]?.stringValue ?? "tool"
      let args = event.data["arguments"]?.stringValue ?? ""
      openTools[callId] = OpenTool(seq: event.seq, name: name, args: args)
      append(.tool(
        id: "tool:\(callId)",
        seq: event.seq,
        callId: callId,
        name: name,
        args: args,
        result: nil,
        status: .running,
        expanded: false,
        meta: nil
      ))

    case "tool/result":
      guard event.data["message"]?["source"]?["kind"]?.stringValue == "tool",
            let callId = event.data["message"]?["source"]?["callId"]?.stringValue else {
        break
      }
      let prior = openTools[callId]
      let result = textOf(event.data["message"]?["content"] ?? .null)
      let contentBlocks = event.data["message"]?["content"]?.arrayValue ?? []
      let hasError = contentBlocks.contains(where: {
        $0["type"]?.stringValue == "tool-result" && $0["isError"]?.boolValue == true
      }) || (event.data["error"] != nil && event.data["error"] != .null)
      upsert(.tool(
        id: "tool:\(callId)",
        seq: prior?.seq ?? event.seq,
        callId: callId,
        name: prior?.name ?? "tool",
        args: prior?.args ?? "",
        result: result,
        status: hasError ? .error : .success,
        expanded: false,
        meta: event.data["meta"]
      ))
      openTools[callId] = OpenTool(seq: prior?.seq ?? event.seq, name: prior?.name ?? "tool", args: prior?.args ?? "")

    case "tool-workflow/run-start":
      let runId = event.data["runId"]?.stringValue ?? ""
      let name = event.data["name"]?.stringValue ?? ""
      let card: TranscriptItem = .workflow(
        id: "workflow:\(runId)",
        seq: event.seq,
        runId: runId,
        name: name,
        status: .running,
        members: [],
        expanded: false
      )
      openWorkflows[runId] = card
      append(card)

    case "tool-workflow/agent-start":
      let runId = event.data["runId"]?.stringValue ?? ""
      guard let prior = openWorkflows[runId],
            case .workflow(let id, let seq, let rId, let name, let status, let members, _) = prior else {
        break
      }
      let memberSeq = event.data["seq"]?.intValue ?? 0
      let label = event.data["label"]?.stringValue ?? ""
      let phase = event.data["phase"]?.stringValue
      let newMember = WorkflowMember(seq: memberSeq, label: label, phase: phase, status: .running)
      let card: TranscriptItem = .workflow(
        id: id, seq: seq, runId: rId, name: name, status: status,
        members: members + [newMember], expanded: false
      )
      upsert(card)
      openWorkflows[runId] = card

    case "tool-workflow/agent-end":
      let runId = event.data["runId"]?.stringValue ?? ""
      guard let prior = openWorkflows[runId],
            case .workflow(let id, let seq, let rId, let name, let status, let members, _) = prior else {
        break
      }
      let memberSeq = event.data["seq"]?.intValue ?? 0
      let outcome = event.data["outcome"]?.stringValue
      let memberStatus: WorkflowStatus = (outcome == "completed") ? .success : .error
      let updatedMembers = members.map { member in
        if member.seq == memberSeq {
          var m = member
          m.status = memberStatus
          return m
        }
        return member
      }
      let card: TranscriptItem = .workflow(
        id: id, seq: seq, runId: rId, name: name, status: status,
        members: updatedMembers, expanded: false
      )
      upsert(card)
      openWorkflows[runId] = card

    case "tool-workflow/run-end":
      let runId = event.data["runId"]?.stringValue ?? ""
      guard let prior = openWorkflows[runId],
            case .workflow(let id, let seq, let rId, let name, _, let members, _) = prior else {
        break
      }
      let stopReason = event.data["stopReason"]?.stringValue
      let runStatus: WorkflowStatus = (stopReason == "completed") ? .success : .error
      let card: TranscriptItem = .workflow(
        id: id, seq: seq, runId: rId, name: name, status: runStatus,
        members: members, expanded: false
      )
      upsert(card)
      openWorkflows[runId] = card

    case "command/done":
      if let text = event.data["text"]?.stringValue {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
          append(.command(id: "cmd:\(event.seq)", seq: event.seq, text: text))
        }
      }

    default:
      break
    }
  }

  /// Characters in the in-flight stream's unsettled trailing paragraph; `0`
  /// when idle. Renderers lay settled paragraphs out once and re-render only
  /// this tail, so it — not the whole buffer — is what render throttling
  /// scales its interval with. Text with no paragraph break yet is all tail.
  public var streamingTailLength: Int {
    let buffered = chunkBuffers.keys.sorted().reduce(into: "") { text, key in
      guard let buffer = chunkBuffers[key] else { return }
      text += buffer.reasoning + buffer.text
    }
    return buffered.isEmpty ? 0 : splitSettledTail(buffered).tail.count
  }

  /// Presentable items: the folded list with expansion applied plus the
  /// in-flight streaming tail.
  /// - Parameter expansion: card ids currently expanded in the UI.
  /// - Returns: items in transcript order.
  public func materialize(
    expansion: TranscriptExpansion = TranscriptExpansion(tools: [], reasoning: [], workflows: [])
  ) -> [TranscriptItem] {
    var out = items
    for id in expansion.tools.union(expansion.reasoning).union(expansion.workflows) {
      guard let index = indexById[id] else { continue }
      out[index] = withExpanded(out[index], true)
    }
    if let streamingTurn = streamingTurn, !chunkBuffers.isEmpty {
      var reasoning = ""
      var text = ""
      for key in chunkBuffers.keys.sorted() {
        if let buffer = chunkBuffers[key] {
          reasoning += buffer.reasoning
          text += buffer.text
        }
      }
      if !reasoning.isEmpty {
        let id = "reason:stream:\(streamingTurn.turn):\(streamingTurn.step)"
        out.append(.reasoning(
          id: id,
          seq: Int.max - 1,
          text: reasoning,
          streaming: true,
          expanded: expansion.reasoning.contains(id)
        ))
      }
      if !text.isEmpty {
        out.append(.assistant(
          id: "asst:stream:\(streamingTurn.turn):\(streamingTurn.step)",
          seq: Int.max,
          text: text,
          streaming: true
        ))
      }
    }
    return out
  }
}

/// Rebuild `item` with its `expanded` flag set where the case carries one.
private func withExpanded(_ item: TranscriptItem, _ expanded: Bool) -> TranscriptItem {
  switch item {
  case .reasoning(let id, let seq, let text, let streaming, _):
    return .reasoning(id: id, seq: seq, text: text, streaming: streaming, expanded: expanded)
  case .tool(let id, let seq, let callId, let name, let args, let result, let status, _, let meta):
    return .tool(id: id, seq: seq, callId: callId, name: name, args: args, result: result, status: status, expanded: expanded, meta: meta)
  case .workflow(let id, let seq, let runId, let name, let status, let members, _):
    return .workflow(id: id, seq: seq, runId: runId, name: name, status: status, members: members, expanded: expanded)
  case .user, .assistant, .command, .artifact:
    return item
  }
}

/// One-shot projection of a complete event list (the incremental
/// `TranscriptProjector` folded over `events`, then materialized).
/// - Parameters:
///   - events: durable session events in seq order.
///   - expansion: card ids currently expanded in the UI.
/// - Returns: items in transcript order.
public func projectTranscript(
  _ events: [SessionEventDTO],
  expansion: TranscriptExpansion = TranscriptExpansion(tools: [], reasoning: [], workflows: [])
) -> [TranscriptItem] {
  var projector = TranscriptProjector()
  for event in events {
    projector.ingest(event)
  }
  return projector.materialize(expansion: expansion)
}
