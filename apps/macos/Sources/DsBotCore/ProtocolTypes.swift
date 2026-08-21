import Foundation

public enum JSONValue: Codable, Equatable, Sendable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .null
    } else if let boolVal = try? container.decode(Bool.self) {
      self = .bool(boolVal)
    } else if let intVal = try? container.decode(Int.self) {
      self = .number(Double(intVal))
    } else if let doubleVal = try? container.decode(Double.self) {
      self = .number(doubleVal)
    } else if let stringVal = try? container.decode(String.self) {
      self = .string(stringVal)
    } else if let arrayVal = try? container.decode([JSONValue].self) {
      self = .array(arrayVal)
    } else if let dictVal = try? container.decode([String: JSONValue].self) {
      self = .object(dictVal)
    } else {
      throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid JSONValue")
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .null:
      try container.encodeNil()
    case .bool(let value):
      try container.encode(value)
    case .number(let value):
      if value.rounded() == value && !value.isInfinite && !value.isNaN && value >= Double(Int.min) && value <= Double(Int.max) {
        try container.encode(Int(value))
      } else {
        try container.encode(value)
      }
    case .string(let value):
      try container.encode(value)
    case .array(let value):
      try container.encode(value)
    case .object(let value):
      try container.encode(value)
    }
  }

  /// Best-effort conversion from `JSONSerialization` values. Bool is `NSNumber`
  /// on this path, so it must be distinguished from 0/1.
  public init(any value: Any) {
    switch value {
    case is NSNull:
      self = .null
    case let b as Bool:
      self = .bool(b)
    case let n as NSNumber:
      if CFGetTypeID(n) == CFBooleanGetTypeID() {
        self = .bool(n.boolValue)
      } else {
        self = .number(n.doubleValue)
      }
    case let s as String:
      self = .string(s)
    case let arr as [Any]:
      self = .array(arr.map { JSONValue(any: $0) })
    case let dict as [String: Any]:
      var out: [String: JSONValue] = [:]
      out.reserveCapacity(dict.count)
      for (k, v) in dict { out[k] = JSONValue(any: v) }
      self = .object(out)
    default:
      self = .string(String(describing: value))
    }
  }
}

public struct PresetListItem: Codable, Equatable, Sendable {
  public var id: String
  public var trust: String
  public var name: String?
  public var description: String?
  public var broken: String?

  public init(id: String, trust: String, name: String? = nil, description: String? = nil, broken: String? = nil) {
    self.id = id
    self.trust = trust
    self.name = name
    self.description = description
    self.broken = broken
  }
}

public struct SessionEventNotification: Codable, Equatable, Sendable {
  public var sessionId: String
  public var event: [String: JSONValue]

  public init(sessionId: String, event: [String: JSONValue]) {
    self.sessionId = sessionId
    self.event = event
  }
}

public struct HarnessRPCError: Error, Equatable, Sendable, LocalizedError {
  public var code: Int
  public var message: String

  public init(code: Int, message: String) {
    self.code = code
    self.message = message
  }

  public var errorDescription: String? {
    return "RPC error \(code): \(message)"
  }
}

public struct ClientCapabilities: Codable, Equatable, Sendable {
  public var approvals: Bool?

  public init(approvals: Bool? = nil) {
    self.approvals = approvals
  }
}

public struct InitializeParams: Codable, Sendable {
  public var cwd: String
  public var provider: String
  public var model: String
  public var clientCapabilities: ClientCapabilities?

  public init(cwd: String, provider: String, model: String, clientCapabilities: ClientCapabilities? = nil) {
    self.cwd = cwd
    self.provider = provider
    self.model = model
    self.clientCapabilities = clientCapabilities
  }
}

public struct InitializeResult: Codable, Sendable {
  public struct ServerInfo: Codable, Sendable {
    public var name: String
    public var version: String
  }
  public var serverInfo: ServerInfo

  public init(serverInfo: ServerInfo) {
    self.serverInfo = serverInfo
  }
}

public struct PresetListResult: Codable, Sendable {
  public var presets: [PresetListItem]

  public init(presets: [PresetListItem]) {
    self.presets = presets
  }
}

public struct PresetCopyParams: Codable, Sendable {
  public var from: String
  public var id: String
  public var name: String?

  public init(from: String, id: String, name: String? = nil) {
    self.from = from
    self.id = id
    self.name = name
  }
}

public struct PresetSetPersonaParams: Codable, Sendable {
  public var id: String
  public var text: String

  public init(id: String, text: String) {
    self.id = id
    self.text = text
  }
}

public struct ContentBlock: Codable, Equatable, Sendable {
  public var type: String
  public var text: String?

  public init(type: String = "text", text: String? = nil) {
    self.type = type
    self.text = text
  }
}

public struct SessionPromptParams: Codable, Sendable {
  public var sessionId: String
  public var contentBlocks: [ContentBlock]
  public var agentPreset: String?
  public var provider: String?
  public var model: String?
  public var reasoningEffort: String?
  /// Steer the running turn at its next step boundary instead of queueing a
  /// new turn; an idle session starts a turn either way.
  public var steer: Bool?

  public init(
    sessionId: String,
    contentBlocks: [ContentBlock],
    agentPreset: String? = nil,
    provider: String? = nil,
    model: String? = nil,
    reasoningEffort: String? = nil,
    steer: Bool? = nil
  ) {
    self.sessionId = sessionId
    self.contentBlocks = contentBlocks
    self.agentPreset = agentPreset
    self.provider = provider
    self.model = model
    self.reasoningEffort = reasoningEffort
    self.steer = steer
  }
}

public struct SessionPromptResult: Codable, Sendable {
  public var messageId: String

  public init(messageId: String) {
    self.messageId = messageId
  }
}

public struct SessionResumeParams: Codable, Sendable {
  public var sessionId: String
  public var provider: String?
  public var model: String?
  public var reasoningEffort: String?

  public init(
    sessionId: String,
    provider: String? = nil,
    model: String? = nil,
    reasoningEffort: String? = nil
  ) {
    self.sessionId = sessionId
    self.provider = provider
    self.model = model
    self.reasoningEffort = reasoningEffort
  }
}

public struct SessionSetModelParams: Codable, Sendable {
  public var sessionId: String
  public var provider: String
  public var model: String
  public var reasoningEffort: String?

  public init(
    sessionId: String,
    provider: String,
    model: String,
    reasoningEffort: String? = nil
  ) {
    self.sessionId = sessionId
    self.provider = provider
    self.model = model
    self.reasoningEffort = reasoningEffort
  }
}

public struct SessionCancelParams: Codable, Sendable {
  public var sessionId: String
  /// Preserve queued and steering inbox work while aborting the active turn;
  /// a steering wake then replays into a fresh turn.
  public var keepInbox: Bool?

  public init(sessionId: String, keepInbox: Bool? = nil) {
    self.sessionId = sessionId
    self.keepInbox = keepInbox
  }
}

public struct EmptyParams: Codable, Sendable {
  public init() {}
}

public struct EmptyResult: Codable, Sendable {
  public init() {}
}
