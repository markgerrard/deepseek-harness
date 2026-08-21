import Darwin
import Foundation

private final class HarnessClientCore: @unchecked Sendable {
  let command: String
  let arguments: [String]
  let cwd: URL?
  let environment: [String: String]?

  private let lock = NSLock()
  private var process: Process?
  private var stdinHandle: FileHandle?
  private var stdoutHandle: FileHandle?
  private var stdoutPipe: Pipe?
  private var stdinPipe: Pipe?
  private var nextId: Int = 1
  private var pendingContinuations: [Int: CheckedContinuation<Data, Error>] = [:]
  private var isStarted = false
  private var isShutdown = false
  private var lineBuffer = Data()
  private var readerThread: Foundation.Thread?
  private var stderrHandle: FileHandle?
  private var requestHandler: (@Sendable (String, JSONValue) async throws -> JSONValue)?

  let events: AsyncStream<SessionEventNotification>
  private var eventContinuation: AsyncStream<SessionEventNotification>.Continuation?

  init(command: String, arguments: [String], cwd: URL?, environment: [String: String]?) {
    self.command = command
    self.arguments = arguments
    self.cwd = cwd
    self.environment = environment

    var cont: AsyncStream<SessionEventNotification>.Continuation?
    self.events = AsyncStream { continuation in
      cont = continuation
    }
    self.eventContinuation = cont
  }

  func onRequest(_ handler: @escaping @Sendable (String, JSONValue) async throws -> JSONValue) {
    lock.withLock {
      self.requestHandler = handler
    }
  }

  func start() throws {
    let thread: Foundation.Thread? = try lock.withLock {
      if isStarted {
        return nil as Foundation.Thread?
      }
      isStarted = true

      let proc = Process()
      proc.executableURL = URL(fileURLWithPath: command)
      proc.arguments = arguments
      if let cwd = cwd {
        proc.currentDirectoryURL = cwd
      }
      if let environment = environment {
        proc.environment = environment
      }

      let stdinPipe = Pipe()
      let stdoutPipe = Pipe()
      proc.standardInput = stdinPipe
      proc.standardOutput = stdoutPipe
      // Pipe stderr to a file. A pipe we do not read will stall the child.
      let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
        .appendingPathComponent("DsBot", isDirectory: true)
      if let dir {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let log = dir.appendingPathComponent("dsh.stderr.log")
        if !FileManager.default.fileExists(atPath: log.path) {
          FileManager.default.createFile(atPath: log.path, contents: nil)
        }
        if let err = try? FileHandle(forWritingTo: log) {
          _ = try? err.seekToEnd()
          proc.standardError = err
          self.stderrHandle = err
        }
      }

      let readHandle = stdoutPipe.fileHandleForReading
      self.process = proc
      self.stdinPipe = stdinPipe
      self.stdoutPipe = stdoutPipe
      self.stdinHandle = stdinPipe.fileHandleForWriting
      self.stdoutHandle = readHandle

      do {
        try proc.run()
      } catch {
        isStarted = false
        throw error
      }

      // Blocking read on a private thread. FileHandle.bytes.lines,
      // readabilityHandler (App.init has no RunLoop), and DispatchSource on the
      // FileHandle fd all left Node JSON-RPC frames sitting in the pipe.
      let fd = readHandle.fileDescriptor
      let thread = Foundation.Thread { [weak self] in
        var buf = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
          let n = read(fd, &buf, buf.count)
          if n > 0 {
            self?.consumeStdout(Data(buf[0..<n]))
          } else {
            self?.handleTermination()
            return
          }
        }
      }
      thread.name = "dsbot.rpc.stdout"
      thread.qualityOfService = .userInitiated
      self.readerThread = thread
      return thread
    }
    thread?.start()
  }

  private func consumeStdout(_ data: Data) {
    var lines: [String] = []
    lock.lock()
    lineBuffer.append(data)
    while let range = lineBuffer.range(of: Data([0x0A])) {
      let lineData = lineBuffer.subdata(in: lineBuffer.startIndex..<range.lowerBound)
      lineBuffer.removeSubrange(lineBuffer.startIndex..<range.upperBound)
      if let line = String(data: lineData, encoding: .utf8) {
        lines.append(line)
      }
    }
    lock.unlock()
    for line in lines {
      Self.appendRpcLog(prefix: "S", line: line)
      handleLine(line)
    }
  }

  private func prepareRequest<P: Encodable & Sendable>(
    method: String,
    params: P
  ) throws -> (id: Int, data: Data, stdin: FileHandle) {
    try lock.withLock {
      guard isStarted, !isShutdown, let proc = process, proc.isRunning, let sin = stdinHandle else {
        throw HarnessRPCError(code: -32000, message: "Client is not running or has been shutdown")
      }
      let id = nextId
      nextId += 1
      let data = try JSONRPCCodec.encodeRequest(id: id, method: method, params: params)
      return (id, data, sin)
    }
  }

  func request<P: Encodable & Sendable, R: Decodable & Sendable>(
    method: String,
    params: P
  ) async throws -> R {
    let (id, data, stdin) = try prepareRequest(method: method, params: params)

    let resultData = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data, Error>) in
      lock.withLock {
        pendingContinuations[id] = continuation
      }

      do {
        try stdin.write(contentsOf: data)
        Self.appendRpcLog(prefix: "C", line: String(data: data, encoding: .utf8) ?? "")
      } catch {
        lock.withLock {
          _ = pendingContinuations.removeValue(forKey: id)
        }
        continuation.resume(throwing: error)
      }
    }

    if R.self == EmptyResult.self {
      return EmptyResult() as! R
    }

    let decoder = JSONDecoder()
    return try decoder.decode(R.self, from: resultData)
  }

  private func handleLine(_ line: String) {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return }
    guard let data = trimmed.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      return
    }

    // 1. Server->Client Request (has both method and id)
    if let method = json["method"] as? String, let rawId = json["id"] {
      let idJSON: JSONValue
      if let idData = try? JSONSerialization.data(withJSONObject: rawId, options: .fragmentsAllowed),
         let parsed = try? JSONDecoder().decode(JSONValue.self, from: idData) {
        idJSON = parsed
      } else if let str = rawId as? String {
        idJSON = .string(str)
      } else if let num = rawId as? NSNumber {
        idJSON = .number(num.doubleValue)
      } else {
        idJSON = .null
      }

      let paramsJSON: JSONValue
      if let paramsObj = json["params"],
         let paramsData = try? JSONSerialization.data(withJSONObject: paramsObj, options: .fragmentsAllowed),
         let parsed = try? JSONDecoder().decode(JSONValue.self, from: paramsData) {
        paramsJSON = parsed
      } else {
        paramsJSON = .object([:])
      }

      let handler = lock.withLock { requestHandler }
      Task { [weak self] in
        guard let self = self else { return }
        guard let handler = handler else {
          self.sendResponseError(id: idJSON, code: -32601, message: "Method not found: \(method)")
          return
        }
        do {
          let result = try await handler(method, paramsJSON)
          self.sendResponseResult(id: idJSON, result: result)
        } catch {
          let code = (error as? HarnessRPCError)?.code ?? -32603
          self.sendResponseError(id: idJSON, code: code, message: error.localizedDescription)
        }
      }
      return
    }

    // 2. Server->Client Response (has id, no method)
    if let idVal = json["id"] {
      let id: Int?
      if let i = idVal as? Int {
        id = i
      } else if let s = idVal as? String, let i = Int(s) {
        id = i
      } else if let n = idVal as? NSNumber {
        id = n.intValue
      } else {
        id = nil
      }

      guard let id = id else { return }

      let continuation = lock.withLock {
        pendingContinuations.removeValue(forKey: id)
      }

      guard let continuation = continuation else { return }

      if let errorObj = json["error"] as? [String: Any] {
        let code = (errorObj["code"] as? Int) ?? -32603
        let message = (errorObj["message"] as? String) ?? "Unknown RPC error"
        continuation.resume(throwing: HarnessRPCError(code: code, message: message))
      } else if let resultObj = json["result"] {
        if let resultData = try? JSONSerialization.data(withJSONObject: resultObj, options: .fragmentsAllowed) {
          continuation.resume(returning: resultData)
        } else {
          continuation.resume(returning: Data("{}".utf8))
        }
      } else {
        continuation.resume(returning: Data("{}".utf8))
      }
      return
    }

    // 3. Server->Client Notification (has method, no id)
    if let method = json["method"] as? String {
      if method == "session.event", let notification = Self.parseSessionEvent(json["params"]) {
        eventContinuation?.yield(notification)
      }
    }
  }

  private static func parseSessionEvent(_ params: Any?) -> SessionEventNotification? {
    guard let params = params as? [String: Any],
          let sessionId = params["sessionId"] as? String else {
      return nil
    }
    let eventValue = JSONValue(any: params["event"] ?? [String: Any]())
    let event: [String: JSONValue]
    if case .object(let obj) = eventValue {
      event = obj
    } else {
      return nil
    }
    return SessionEventNotification(sessionId: sessionId, event: event)
  }

  private static let rpcLogLock = NSLock()

  static func appendRpcLog(prefix: String, line: String) {
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
      .appendingPathComponent("DsBot", isDirectory: true)
    guard let dir else { return }
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let url = dir.appendingPathComponent("dsh.rpc.log")
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    let clipped = trimmed.count > 4000 ? String(trimmed.prefix(4000)) + "…" : trimmed
    let stamp = ISO8601DateFormatter().string(from: Date())
    let row = "\(stamp) \(prefix) \(clipped)\n"
    rpcLogLock.lock()
    defer { rpcLogLock.unlock() }
    if !FileManager.default.fileExists(atPath: url.path) {
      FileManager.default.createFile(atPath: url.path, contents: nil)
    }
    guard let handle = try? FileHandle(forWritingTo: url) else { return }
    defer { try? handle.close() }
    _ = try? handle.seekToEnd()
    try? handle.write(contentsOf: Data(row.utf8))
  }

  private func sendResponseResult(id: JSONValue, result: JSONValue) {
    let response = JSONRPCResponse(id: id, result: result)
    guard let data = try? JSONEncoder().encode(response) else { return }
    var lineData = data
    lineData.append(0x0A)
    lock.withLock {
      guard isStarted, !isShutdown, let sin = stdinHandle else { return }
      try? sin.write(contentsOf: lineData)
    }
    Self.appendRpcLog(prefix: "C", line: String(data: data, encoding: .utf8) ?? "")
  }

  private func sendResponseError(id: JSONValue, code: Int, message: String) {
    let response = JSONRPCErrorResponse(id: id, error: JSONRPCErrorPayload(code: code, message: message))
    guard let data = try? JSONEncoder().encode(response) else { return }
    var lineData = data
    lineData.append(0x0A)
    lock.withLock {
      guard isStarted, !isShutdown, let sin = stdinHandle else { return }
      try? sin.write(contentsOf: lineData)
    }
  }

  private func handleTermination() {
    let pending = lock.withLock { () -> [CheckedContinuation<Data, Error>] in
      let list = Array(pendingContinuations.values)
      pendingContinuations.removeAll()
      eventContinuation?.finish()
      eventContinuation = nil
      return list
    }

    for cont in pending {
      cont.resume(throwing: HarnessRPCError(code: -32000, message: "Transport closed"))
    }
  }

  func shutdown() async throws {
    let alreadyShutdown = lock.withLock { isShutdown }
    if alreadyShutdown { return }

    do {
      let _: EmptyResult = try await request(method: "shutdown", params: EmptyParams())
    } catch {
      // Best-effort shutdown request
    }

    let proc = lock.withLock { () -> Process? in
      isShutdown = true
      readerThread?.cancel()
      stdoutHandle?.readabilityHandler = nil
      try? stdoutHandle?.close()
      stdoutHandle = nil
      try? stdinHandle?.close()
      stdinHandle = nil
      stderrHandle?.readabilityHandler = nil
      try? stderrHandle?.close()
      stderrHandle = nil
      return process
    }

    if let proc = proc {
      proc.waitUntilExit()
    }
    handleTermination()
  }
}

public struct HarnessClient: Sendable {
  private let core: HarnessClientCore

  public init(command: String, arguments: [String] = [], cwd: URL? = nil, environment: [String: String]? = nil) {
    self.core = HarnessClientCore(command: command, arguments: arguments, cwd: cwd, environment: environment)
  }

  public func onRequest(_ handler: @escaping @Sendable (String, JSONValue) async throws -> JSONValue) {
    core.onRequest(handler)
  }

  public func start() throws {
    try core.start()
  }

  public func initialize(cwd: String, provider: String, model: String, approvals: Bool) async throws {
    let capabilities = approvals ? ClientCapabilities(approvals: true) : nil
    let params = InitializeParams(cwd: cwd, provider: provider, model: model, clientCapabilities: capabilities)
    let _: InitializeResult = try await core.request(method: "initialize", params: params)
  }

  public func listPresets() async throws -> [PresetListItem] {
    let result: PresetListResult = try await core.request(method: "presets/list", params: EmptyParams())
    return result.presets
  }

  public func copyPreset(from: String, id: String, name: String?) async throws {
    let params = PresetCopyParams(from: from, id: id, name: name)
    let _: EmptyResult = try await core.request(method: "presets/copy", params: params)
  }

  public func setPersona(id: String, text: String) async throws {
    let params = PresetSetPersonaParams(id: id, text: text)
    let _: EmptyResult = try await core.request(method: "presets/setPersona", params: params)
  }

  public func prompt(
    sessionId: String,
    text: String,
    agentPreset: String?,
    provider: String?,
    model: String?,
    reasoningEffort: String?,
    steer: Bool = true
  ) async throws -> String {
    let params = SessionPromptParams(
      sessionId: sessionId,
      contentBlocks: [ContentBlock(type: "text", text: text)],
      agentPreset: agentPreset,
      provider: provider,
      model: model,
      reasoningEffort: reasoningEffort,
      steer: steer
    )
    let result: SessionPromptResult = try await core.request(method: "session/prompt", params: params)
    return result.messageId
  }

  public func resume(
    sessionId: String,
    provider: String?,
    model: String?,
    reasoningEffort: String?
  ) async throws {
    let params = SessionResumeParams(
      sessionId: sessionId,
      provider: provider,
      model: model,
      reasoningEffort: reasoningEffort
    )
    let _: EmptyResult = try await core.request(method: "session/resume", params: params)
  }

  public func setModel(
    sessionId: String,
    provider: String,
    model: String,
    reasoningEffort: String?
  ) async throws {
    let params = SessionSetModelParams(
      sessionId: sessionId,
      provider: provider,
      model: model,
      reasoningEffort: reasoningEffort
    )
    let _: EmptyResult = try await core.request(method: "session/setModel", params: params)
  }

  public func cancel(sessionId: String, keepInbox: Bool = false) async throws {
    let params = SessionCancelParams(sessionId: sessionId, keepInbox: keepInbox ? true : nil)
    let _: EmptyResult = try await core.request(method: "session/cancel", params: params)
  }

  public func shutdown() async throws {
    try await core.shutdown()
  }

  public var events: AsyncStream<SessionEventNotification> {
    core.events
  }
}
