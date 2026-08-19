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

  func testListPresetsTalksToFakeRuntime() async throws {
    let runtime = try bundledFakeRuntimeURL()
    var client = HarnessClient(command: runtime.path, arguments: [], cwd: nil)
    try client.start()
    try await client.initialize(cwd: "/tmp", provider: "mock", model: "m", approvals: true)
    let presets = try await client.listPresets()
    XCTAssertEqual(presets.map(\.id), ["code"])
    try await client.shutdown()
  }

  func testPromptReturnsMessageId() async throws {
    let runtime = try bundledFakeRuntimeURL()
    var client = HarnessClient(command: runtime.path, arguments: [], cwd: nil)
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
    var client = HarnessClient(command: runtime.path, arguments: [], cwd: nil)
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
    var client = HarnessClient(command: runtime.path, arguments: [], cwd: nil)
    try client.start()
    try await client.initialize(cwd: "/tmp", provider: "mock", model: "m", approvals: false)
    try await client.copyPreset(from: "code", id: "bot-1", name: "Bot One")
    try await client.setPersona(id: "bot-1", text: "You are Bot One.")
    try await client.resume(sessionId: "s1", provider: "mock", model: "m", reasoningEffort: "high")
    try await client.setModel(sessionId: "s1", provider: "mock", model: "m2", reasoningEffort: "max")
    try await client.cancel(sessionId: "s1")
    try await client.shutdown()
  }
}
