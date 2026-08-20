import Foundation
import XCTest
@testable import DsBotCore

final class HarnessClientTests: XCTestCase {
  private func bundledFakeRuntimeURL() throws -> URL {
    #if os(macOS)
    for bundle in Bundle.allBundles where bundle.bundlePath.hasSuffix(".xctest") {
      let url = bundle.bundleURL.deletingLastPathComponent().appendingPathComponent("FakeSdkRuntime")
      if FileManager.default.isExecutableFile(atPath: url.path) { return url }
    }
    #endif
    throw NSError(domain: "DsBotCoreTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "FakeSdkRuntime product not found"])
  }

  func testInitializeReadsFromRealMacosProfile() async throws {
    let repo = RuntimeLaunch.findRepoRoot()
      ?? URL(fileURLWithPath: "/Volumes/Workspace/repos/dsbot")
    let bin = repo.appendingPathComponent("apps/cli/lib/bin.js")
    try XCTSkipUnless(FileManager.default.isReadableFile(atPath: bin.path), "macos CLI not built")
    try XCTSkipUnless(LaunchCredentials.clineApiKey() != nil, "CLINE_API_KEY not available")

    let home = FileManager.default.temporaryDirectory.appendingPathComponent("dsh-home-\(UUID().uuidString)")
    let ws = FileManager.default.temporaryDirectory.appendingPathComponent("dsh-ws-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: ws, withIntermediateDirectories: true)
    defer {
      try? FileManager.default.removeItem(at: home)
      try? FileManager.default.removeItem(at: ws)
    }

    var env = LaunchCredentials.childEnvironment()
    env["DSH_HOME"] = home.path
    let node = FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/node")
      ? "/opt/homebrew/bin/node" : "node"
    let client = HarnessClient(
      command: node,
      arguments: [bin.path, "--profile", "macos"],
      cwd: ws,
      environment: env
    )
    try client.start()
    let started = Date()
    try await client.initialize(
      cwd: ws.path,
      provider: "cline-pass",
      model: "cline-pass/deepseek-v4-flash",
      approvals: true
    )
    XCTAssertLessThan(Date().timeIntervalSince(started), 15)
    try await client.shutdown()
  }

  func testInitializeWithAppWorkspaceAndUserHome() async throws {
    let repo = RuntimeLaunch.findRepoRoot()
      ?? URL(fileURLWithPath: "/Volumes/Workspace/repos/dsbot")
    let bin = repo.appendingPathComponent("apps/cli/lib/bin.js")
    try XCTSkipUnless(FileManager.default.isReadableFile(atPath: bin.path), "macos CLI not built")
    try XCTSkipUnless(LaunchCredentials.clineApiKey() != nil, "CLINE_API_KEY not available")

    let ws = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("DsBot/workspace", isDirectory: true)
    try FileManager.default.createDirectory(at: ws, withIntermediateDirectories: true)

    let env = LaunchCredentials.childEnvironment()
    let node = FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/node")
      ? "/opt/homebrew/bin/node" : "node"
    let client = HarnessClient(
      command: node,
      arguments: [bin.path, "--profile", "macos"],
      cwd: ws,
      environment: env
    )
    try client.start()
    try await client.initialize(
      cwd: ws.path,
      provider: "cline-pass",
      model: "cline-pass/deepseek-v4-flash",
      approvals: true
    )
    try await client.shutdown()
  }

  func testListPresetsTalksToFakeRuntime() async throws {
    let runtime = try bundledFakeRuntimeURL()
    let client = HarnessClient(command: runtime.path, arguments: [], cwd: nil)
    try client.start()
    try await client.initialize(cwd: "/tmp", provider: "mock", model: "m", approvals: true)
    let presets = try await client.listPresets()
    XCTAssertEqual(presets.map(\.id), ["code"])
    try await client.shutdown()
  }

  func testPromptReturnsMessageId() async throws {
    let runtime = try bundledFakeRuntimeURL()
    let client = HarnessClient(command: runtime.path, arguments: [], cwd: nil)
    try client.start()
    try await client.initialize(cwd: "/tmp", provider: "mock", model: "m", approvals: true)
    let messageId = try await client.prompt(
      sessionId: "s1",
      text: "hi",
      agentPreset: nil,
      provider: nil,
      model: nil,
      reasoningEffort: nil
    )
    XCTAssertEqual(messageId, "m1")
    try await client.shutdown()
  }

  func testPromptWithExtras() async throws {
    let runtime = try bundledFakeRuntimeURL()
    let client = HarnessClient(command: runtime.path, arguments: [], cwd: nil)
    try client.start()
    try await client.initialize(cwd: "/tmp", provider: "mock", model: "m", approvals: true)
    let messageId = try await client.prompt(
      sessionId: "s1",
      text: "hello world",
      agentPreset: "code",
      provider: "deepseek",
      model: "deepseek-v4",
      reasoningEffort: "high"
    )
    XCTAssertEqual(messageId, "m1")
    try await client.shutdown()
  }

  func testOtherRPCMethods() async throws {
    let runtime = try bundledFakeRuntimeURL()
    let client = HarnessClient(command: runtime.path, arguments: [], cwd: nil)
    try client.start()
    try await client.initialize(cwd: "/tmp", provider: "mock", model: "m", approvals: false)
    try await client.copyPreset(from: "code", id: "bot-1", name: "Bot One")
    try await client.setPersona(id: "bot-1", text: "You are Bot One.")
    try await client.resume(sessionId: "s1", provider: "mock", model: "m", reasoningEffort: "high")
    try await client.setModel(sessionId: "s1", provider: "mock", model: "m2", reasoningEffort: "max")
    try await client.cancel(sessionId: "s1")
    try await client.shutdown()
  }

  func testOnRequestReceivesServerRequest() async throws {
    let runtime = try bundledFakeRuntimeURL()
    let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let recordPath = tempDir.appendingPathComponent("perm_response.txt").path
    let client = HarnessClient(
      command: runtime.path,
      arguments: [],
      cwd: nil,
      environment: [
        "FAKE_ASK_PERMISSION": "1",
        "FAKE_RECORD_PERMISSION": recordPath
      ]
    )

    let requestReceived = expectation(description: "onRequest received")
    client.onRequest { method, params in
      XCTAssertEqual(method, "session/request_permission")
      if case .object(let dict) = params {
        XCTAssertEqual(dict["sessionId"], .string("main"))
        XCTAssertEqual(dict["toolName"], .string("bash"))
      } else {
        XCTFail("Expected params to be object")
      }
      requestReceived.fulfill()
      return .object(["outcome": .string("rejected")])
    }

    try client.start()
    try await client.initialize(cwd: "/tmp", provider: "mock", model: "m", approvals: true)

    await fulfillment(of: [requestReceived], timeout: 5.0)

    // Brief sleep to ensure fake runtime processed the response write
    try await Task.sleep(nanoseconds: 50_000_000)
    try await client.shutdown()

    let record = try String(contentsOfFile: recordPath, encoding: .utf8)
    XCTAssertTrue(record.contains("\"outcome\":\"rejected\""))
  }
}
