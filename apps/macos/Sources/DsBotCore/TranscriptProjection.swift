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

  public var id: String {
    switch self {
    case .user(let id, _, _, _): return id
    case .assistant(let id, _, _, _): return id
    case .reasoning(let id, _, _, _, _): return id
    case .tool(let id, _, _, _, _, _, _, _, _): return id
    case .command(let id, _, _): return id
    case .workflow(let id, _, _, _, _, _, _): return id
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

public func projectTranscript(
  _ events: [SessionEventDTO],
  expansion: TranscriptExpansion = TranscriptExpansion(tools: [], reasoning: [], workflows: [])
) -> [TranscriptItem] {
  var items: [TranscriptItem] = []
  var chunkBuffers: [Int: ChunkBuffer] = [:]
  var openTools: [String: OpenTool] = [:]
  var openWorkflows: [String: TranscriptItem] = [:]
  var streamingTurn: StreamingTurn?

  for event in events {
    switch event.type {
    case "user/message":
      guard event.data["source"]?["kind"]?.stringValue == "user" else { break }
      let text = textOf(event.data["content"] ?? .null).trimmingCharacters(in: .whitespacesAndNewlines)
      let attachments = ChatAttachment.list(from: event.data["attachments"])
      guard !text.isEmpty || !attachments.isEmpty else { break }
      items.append(.user(id: "user:\(event.seq)", seq: event.seq, text: text, attachments: attachments))

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
            let id = "reason:\(event.seq)"
            items.append(.reasoning(
              id: id,
              seq: event.seq,
              text: blockText,
              streaming: false,
              expanded: expansion.reasoning.contains(id)
            ))
          }
          if blockType == "text" && !blockText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let id = "asst:\(event.seq)"
            items.append(.assistant(
              id: id,
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
      let id = "tool:\(callId)"
      let card: TranscriptItem = .tool(
        id: id,
        seq: event.seq,
        callId: callId,
        name: name,
        args: args,
        result: nil,
        status: .running,
        expanded: expansion.tools.contains(id),
        meta: nil
      )
      openTools[callId] = OpenTool(seq: event.seq, name: name, args: args)
      items.append(card)

    case "tool/result":
      guard event.data["message"]?["source"]?["kind"]?.stringValue == "tool",
            let callId = event.data["message"]?["source"]?["callId"]?.stringValue else {
        break
      }
      let id = "tool:\(callId)"
      let prior = openTools[callId]
      let result = textOf(event.data["message"]?["content"] ?? .null)
      let contentBlocks = event.data["message"]?["content"]?.arrayValue ?? []
      let hasError = contentBlocks.contains(where: {
        $0["type"]?.stringValue == "tool-result" && $0["isError"]?.boolValue == true
      }) || (event.data["error"] != nil && event.data["error"] != .null)
      let status: ToolCardStatus = hasError ? .error : .success
      let card: TranscriptItem = .tool(
        id: id,
        seq: prior?.seq ?? event.seq,
        callId: callId,
        name: prior?.name ?? "tool",
        args: prior?.args ?? "",
        result: result,
        status: status,
        expanded: expansion.tools.contains(id),
        meta: event.data["meta"]
      )
      if let lastIndex = items.lastIndex(where: {
        if case .tool(let tid, _, _, _, _, _, _, _, _) = $0 { return tid == id }
        return false
      }) {
        items[lastIndex] = card
      } else {
        items.append(card)
      }
      openTools[callId] = OpenTool(seq: prior?.seq ?? event.seq, name: prior?.name ?? "tool", args: prior?.args ?? "")

    case "tool-workflow/run-start":
      let runId = event.data["runId"]?.stringValue ?? ""
      let name = event.data["name"]?.stringValue ?? ""
      let id = "workflow:\(runId)"
      let card: TranscriptItem = .workflow(
        id: id,
        seq: event.seq,
        runId: runId,
        name: name,
        status: .running,
        members: [],
        expanded: expansion.workflows.contains(id)
      )
      openWorkflows[runId] = card
      items.append(card)

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
        id: id,
        seq: seq,
        runId: rId,
        name: name,
        status: status,
        members: members + [newMember],
        expanded: expansion.workflows.contains(id)
      )
      if let lastIndex = items.lastIndex(where: { $0.id == id }) {
        items[lastIndex] = card
      }
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
        id: id,
        seq: seq,
        runId: rId,
        name: name,
        status: status,
        members: updatedMembers,
        expanded: expansion.workflows.contains(id)
      )
      if let lastIndex = items.lastIndex(where: { $0.id == id }) {
        items[lastIndex] = card
      }
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
        id: id,
        seq: seq,
        runId: rId,
        name: name,
        status: runStatus,
        members: members,
        expanded: expansion.workflows.contains(id)
      )
      if let lastIndex = items.lastIndex(where: { $0.id == id }) {
        items[lastIndex] = card
      }
      openWorkflows[runId] = card

    case "command/done":
      if let text = event.data["text"]?.stringValue {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
          items.append(.command(id: "cmd:\(event.seq)", seq: event.seq, text: text))
        }
      }

    default:
      break
    }
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
      items.append(.reasoning(
        id: id,
        seq: Int.max - 1,
        text: reasoning,
        streaming: true,
        expanded: expansion.reasoning.contains(id)
      ))
    }
    if !text.isEmpty {
      let id = "asst:stream:\(streamingTurn.turn):\(streamingTurn.step)"
      items.append(.assistant(
        id: id,
        seq: Int.max,
        text: text,
        streaming: true
      ))
    }
  }

  return items
}
