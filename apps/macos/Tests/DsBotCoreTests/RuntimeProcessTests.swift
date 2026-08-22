import Foundation
import XCTest
@testable import DsBotCore

final class RuntimeProcessTests: XCTestCase {
  private func bundledFakeRuntimeURL() throws -> URL {
    #if os(macOS)
    for bundle in Bundle.allBundles where bundle.bundlePath.hasSuffix(".xctest") {
      let url = bundle.bundleURL.deletingLastPathComponent().appendingPathComponent("FakeSdkRuntime")
      if FileManager.default.isExecutableFile(atPath: url.path) { return url }
    }
    #endif
    throw NSError(domain: "RuntimeProcessTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "FakeSdkRuntime product not found"])
  }

  func testRuntimeProcessShutdown() async throws {
    let runtime = try bundledFakeRuntimeURL()
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let shutdownFile = tempDir.appendingPathComponent("shutdown.txt")
    let launch = RuntimeLaunch(
      command: runtime.path,
      arguments: [],
      cwd: tempDir,
      environment: ["FAKE_RECORD_SHUTDOWN": shutdownFile.path]
    )

    let process = RuntimeProcess(launch: launch)
    let client = try process.start()
    try await client.initialize(cwd: tempDir.path, provider: "mock", model: "m", approvals: true)
    try await process.stop()

    let content = try String(contentsOf: shutdownFile, encoding: .utf8)
    XCTAssertTrue(content.contains("shutdown"))
  }

  func testRuntimeProcessPermissionRequest() async throws {
    let runtime = try bundledFakeRuntimeURL()
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let permRecordFile = tempDir.appendingPathComponent("perm.txt")
    let launch = RuntimeLaunch(
      command: runtime.path,
      arguments: [],
      cwd: tempDir,
      environment: [
        "FAKE_ASK_PERMISSION": "1",
        "FAKE_RECORD_PERMISSION": permRecordFile.path
      ]
    )

    let process = RuntimeProcess(launch: launch)
    let client = try process.start()
    client.onRequest { method, params in
      if method == "session/request_permission" {
        return .object(["outcome": .string(outcomeForDismissedSheet().rawValue)])
      }
      throw HarnessRPCError(code: -32601, message: "unknown method: \(method)")
    }

    try await client.initialize(cwd: tempDir.path, provider: "mock", model: "m", approvals: true)

    // Allow time for the permission request-response cycle to land in the record file
    try await Task.sleep(nanoseconds: 100_000_000)
    try await process.stop()

    let content = try String(contentsOf: permRecordFile, encoding: .utf8)
    XCTAssertTrue(content.contains("rejected"))
    XCTAssertTrue(content.contains("perm-1"))
  }

  func testRuntimeLaunchMacosProfile() {
    let repoRoot = URL(fileURLWithPath: "/workspace/repo")
    let workspace = URL(fileURLWithPath: "/workspace/project")
    let launch = RuntimeLaunch.macosProfile(repoRoot: repoRoot, workspace: workspace)

    XCTAssertEqual(launch.command, "node")
    XCTAssertEqual(launch.arguments, ["/workspace/repo/apps/cli/lib/bin.js", "--profile", "macos"])
    XCTAssertEqual(launch.cwd, workspace)
  }

  func testFindRepoRootSeesCliBin() {
    let repo = RuntimeLaunch.findRepoRoot()
    XCTAssertNotNil(repo)
    if let repo {
      XCTAssertTrue(FileManager.default.isReadableFile(atPath: repo.appendingPathComponent("apps/cli/lib/bin.js").path))
    }
  }

  func testStartTwiceThrows() async throws {
    let runtime = try bundledFakeRuntimeURL()
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let launch = RuntimeLaunch(command: runtime.path, arguments: [], cwd: tempDir)
    let process = RuntimeProcess(launch: launch)
    _ = try process.start()

    XCTAssertThrowsError(try process.start()) { error in
      guard let rpcError = error as? HarnessRPCError else {
        XCTFail("Expected HarnessRPCError")
        return
      }
      XCTAssertEqual(rpcError.code, -32000)
    }

    try await process.stop()
  }

  /// An unresponsive runtime must not hang teardown: `stop()` bounds the
  /// shutdown request, then SIGTERMs and SIGKILLs the child.
  func testStopForceKillsUnresponsiveRuntime() async throws {
    let runtime = try bundledFakeRuntimeURL()
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let launch = RuntimeLaunch(
      command: runtime.path,
      arguments: [],
      cwd: tempDir,
      environment: ["FAKE_HANG_SHUTDOWN": "1"]
    )

    let process = RuntimeProcess(launch: launch)
    let client = try process.start()
    try await client.initialize(cwd: tempDir.path, provider: "mock", model: "m", approvals: true)

    try await process.stop()

    let shutdownFile = tempDir.appendingPathComponent("shutdown.txt")
    XCTAssertFalse(FileManager.default.fileExists(atPath: shutdownFile.path))
  }
}
