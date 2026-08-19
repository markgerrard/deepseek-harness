import Foundation

public struct RuntimeLaunch: Equatable, Sendable {
  public var command: String
  public var arguments: [String]
  public var cwd: URL
  public var environment: [String: String]?

  public init(command: String, arguments: [String] = [], cwd: URL, environment: [String: String]? = nil) {
    self.command = command
    self.arguments = arguments
    self.cwd = cwd
    self.environment = environment
  }

  public static func macosProfile(
    repoRoot: URL,
    workspace: URL,
    node: String = "node",
    environment: [String: String]? = nil
  ) -> RuntimeLaunch {
    let scriptURL = repoRoot.appendingPathComponent("apps/cli/lib/bin.js")
    return RuntimeLaunch(
      command: node,
      arguments: [scriptURL.path, "--profile", "macos"],
      cwd: workspace,
      environment: environment
    )
  }

  /// Walk from `start` (default: process cwd) until `apps/cli/lib/bin.js` exists.
  public static func findRepoRoot(from start: URL? = nil) -> URL? {
    if let env = ProcessInfo.processInfo.environment["DSH_REPO"], !env.isEmpty {
      return URL(fileURLWithPath: env)
    }
    var dir = start ?? URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
    for _ in 0..<10 {
      let bin = dir.appendingPathComponent("apps/cli/lib/bin.js")
      if FileManager.default.isReadableFile(atPath: bin.path) { return dir }
      let parent = dir.deletingLastPathComponent()
      if parent.path == dir.path { break }
      dir = parent
    }
    return nil
  }
}

public struct RuntimeProcess: Sendable {
  private final class Core: @unchecked Sendable {
    let launch: RuntimeLaunch
    private let lock = NSLock()
    private var client: HarnessClient?
    private var isStarted = false
    private var isStopped = false

    init(launch: RuntimeLaunch) {
      self.launch = launch
    }

    func start() throws -> HarnessClient {
      try lock.withLock {
        if isStarted {
          throw HarnessRPCError(code: -32000, message: "RuntimeProcess is already started")
        }
        isStarted = true
        let newClient = HarnessClient(
          command: launch.command,
          arguments: launch.arguments,
          cwd: launch.cwd,
          environment: launch.environment
        )
        try newClient.start()
        self.client = newClient
        return newClient
      }
    }

    func stop() async throws {
      let activeClient = lock.withLock { () -> HarnessClient? in
        if isStopped { return nil }
        isStopped = true
        let c = client
        client = nil
        return c
      }
      if let activeClient = activeClient {
        try await activeClient.shutdown()
      }
    }
  }

  private let core: Core

  public init(launch: RuntimeLaunch) {
    self.core = Core(launch: launch)
  }

  public func start() throws -> HarnessClient {
    try core.start()
  }

  public func stop() async throws {
    try await core.stop()
  }
}
