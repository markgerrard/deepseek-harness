import Foundation

private final class HarnessClientCore: @unchecked Sendable {
  let command: String
  let arguments: [String]
  let cwd: URL?

  private let lock = NSLock()
  private var process: Process?
  private var stdinHandle: FileHandle?
  private var nextId: Int = 1
  private var pendingContinuations: [Int: CheckedContinuation<Data, Error>] = [:]
  private var isStarted = false
  private var isShutdown = false
  private var readTask: Task<Void, Never>?

  let events: AsyncStream<SessionEventNotification>
  private var eventContinuation: AsyncStream<SessionEventNotification>.Continuation?

  init(command: String, arguments: [String], cwd: URL?) {
    self.command = command
    self.arguments = arguments
    self.cwd = cwd

    var cont: AsyncStream<SessionEventNotification>.Continuation?
    self.events = AsyncStream { continuation in
      cont = continuation
    }
    self.eventContinuation = cont
  }

  func start() throws {
    let (proc, stdoutHandle): (Process, FileHandle) = try lock.withLock {
      if isStarted {
        throw HarnessRPCError(code: -32000, message: "Client is already started")
      }
      isStarted = true

      let proc = Process()
      proc.executableURL = URL(fileURLWithPath: command)
      proc.arguments = arguments
      if let cwd = cwd {
        proc.currentDirectoryURL = cwd
      }

      let stdinPipe = Pipe()
      let stdoutPipe = Pipe()
      let stderrPipe = Pipe()

      proc.standardInput = stdinPipe
      proc.standardOutput = stdoutPipe
      proc.standardError = stderrPipe

      self.process = proc
      self.stdinHandle = stdinPipe.fileHandleForWriting

      do {
        try proc.run()
      } catch {
        isStarted = false
        throw error
      }

      return (proc, stdoutPipe.fileHandleForReading)
    }

    _ = proc
    self.readTask = Task { [weak self] in
      do {
        for try await line in stdoutHandle.bytes.lines {
          self?.handleLine(line)
        }
      } catch {
        // Stream ended or failed
      }
      self?.handleTermination()
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
        if let resultData = try? JSONSerialization.data(withJSONObject: resultObj) {
          continuation.resume(returning: resultData)
        } else {
          continuation.resume(returning: Data("{}".utf8))
        }
      } else {
        continuation.resume(returning: Data("{}".utf8))
      }
      return
    }

    if let method = json["method"] as? String {
      if method == "session.event" {
        if let params = json["params"] as? [String: Any],
           let paramsData = try? JSONSerialization.data(withJSONObject: params),
           let notification = try? JSONDecoder().decode(SessionEventNotification.self, from: paramsData) {
          eventContinuation?.yield(notification)
        }
      }
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
      try? stdinHandle?.close()
      stdinHandle = nil
      return process
    }

    if let proc = proc {
      proc.waitUntilExit()
    }
    readTask?.cancel()
    handleTermination()
  }
}

public struct HarnessClient: Sendable {
  private let core: HarnessClientCore

  public init(command: String, arguments: [String] = [], cwd: URL? = nil) {
    self.core = HarnessClientCore(command: command, arguments: arguments, cwd: cwd)
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
    reasoningEffort: String?
  ) async throws -> String {
    let params = SessionPromptParams(
      sessionId: sessionId,
      contentBlocks: [ContentBlock(type: "text", text: text)],
      agentPreset: agentPreset,
      provider: provider,
      model: model,
      reasoningEffort: reasoningEffort
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

  public func cancel(sessionId: String) async throws {
    let params = SessionCancelParams(sessionId: sessionId)
    let _: EmptyResult = try await core.request(method: "session/cancel", params: params)
  }

  public func shutdown() async throws {
    try await core.shutdown()
  }

  public var events: AsyncStream<SessionEventNotification> {
    core.events
  }
}
