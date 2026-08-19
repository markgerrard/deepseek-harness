import Foundation
import XCTest
@testable import DsBotCore

final class LaunchCredentialsTests: XCTestCase {
  func testPrefersNonEmptyEnvOverFile() throws {
    let home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: home.appendingPathComponent(".dsh"), withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: home) }
    try "CLINE_API_KEY: from-file\n".write(
      to: home.appendingPathComponent(".dsh/.credentials.yaml"),
      atomically: true,
      encoding: .utf8
    )
    let key = LaunchCredentials.clineApiKey(
      environment: ["CLINE_API_KEY": "from-env"],
      home: home
    )
    XCTAssertEqual(key, "from-env")
  }

  func testReadsYamlWhenEnvMissing() throws {
    let home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: home.appendingPathComponent(".dsh"), withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: home) }
    try "CLINE_API_KEY: sk_file_only\n".write(
      to: home.appendingPathComponent(".dsh/.credentials.yaml"),
      atomically: true,
      encoding: .utf8
    )
    let key = LaunchCredentials.clineApiKey(environment: [:], home: home)
    XCTAssertEqual(key, "sk_file_only")
  }

  func testChildEnvironmentSetsTelemetryAndKey() throws {
    let home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: home.appendingPathComponent(".dsh"), withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: home) }
    try "CLINE_API_KEY: sk_child\n".write(
      to: home.appendingPathComponent(".dsh/.credentials.yaml"),
      atomically: true,
      encoding: .utf8
    )
    let env = LaunchCredentials.childEnvironment(base: ["PATH": "/usr/bin"], home: home)
    XCTAssertEqual(env["DSH_TELEMETRY_DISABLED"], "1")
    XCTAssertEqual(env["CLINE_API_KEY"], "sk_child")
    XCTAssertEqual(env["PATH"], "/usr/bin")
  }
}
