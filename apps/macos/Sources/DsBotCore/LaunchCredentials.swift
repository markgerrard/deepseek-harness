import Foundation

public enum LaunchCredentials: Sendable {
  /// `CLINE_API_KEY` from process env, else `~/.dsh/.credentials.yaml`. Never logs the value.
  public static func clineApiKey(
    environment: [String: String] = ProcessInfo.processInfo.environment,
    home: URL = FileManager.default.homeDirectoryForCurrentUser
  ) -> String? {
    if let fromEnv = environment["CLINE_API_KEY"] {
      let trimmed = fromEnv.trimmingCharacters(in: .whitespacesAndNewlines)
      if !trimmed.isEmpty { return trimmed }
    }
    let url = home.appendingPathComponent(".dsh").appendingPathComponent(".credentials.yaml")
    guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
    for line in text.split(whereSeparator: \.isNewline) {
      let raw = String(line)
      guard raw.hasPrefix("CLINE_API_KEY:") else { continue }
      var value = String(raw.dropFirst("CLINE_API_KEY:".count))
        .trimmingCharacters(in: .whitespacesAndNewlines)
      if value.count >= 2 {
        let first = value.first
        let last = value.last
        if (first == "\"" && last == "\"") || (first == "'" && last == "'") {
          value = String(value.dropFirst().dropLast())
        }
      }
      if !value.isEmpty { return value }
    }
    return nil
  }

  public static func childEnvironment(
    base: [String: String] = ProcessInfo.processInfo.environment,
    home: URL = FileManager.default.homeDirectoryForCurrentUser
  ) -> [String: String] {
    var env = base
    env["DSH_TELEMETRY_DISABLED"] = "1"
    if env["HOME"] == nil || env["HOME"]?.isEmpty == true {
      env["HOME"] = home.path
    }
    env["PATH"] = mergedPath(env["PATH"])
    let fromFile = loadCredentialMap(home: home)
    for key in ["CLINE_API_KEY", "OPENCODE_API_KEY"] {
      if env[key]?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true {
        if let value = fromFile[key], !value.isEmpty {
          env[key] = value
        }
      }
    }
    return env
  }

  public static func credentialsFile(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
    home.appendingPathComponent(".dsh").appendingPathComponent(".credentials.yaml")
  }

  public static func loadCredentialMap(
    home: URL = FileManager.default.homeDirectoryForCurrentUser
  ) -> [String: String] {
    guard let text = try? String(contentsOf: credentialsFile(home: home), encoding: .utf8) else {
      return [:]
    }
    var map: [String: String] = [:]
    for line in text.split(whereSeparator: \.isNewline) {
      let raw = String(line)
      guard let colon = raw.firstIndex(of: ":") else { continue }
      let key = String(raw[..<colon]).trimmingCharacters(in: .whitespacesAndNewlines)
      guard !key.isEmpty, !key.hasPrefix("#") else { continue }
      var value = String(raw[raw.index(after: colon)...]).trimmingCharacters(in: .whitespacesAndNewlines)
      if value.count >= 2 {
        let first = value.first
        let last = value.last
        if (first == "\"" && last == "\"") || (first == "'" && last == "'") {
          value = String(value.dropFirst().dropLast())
        }
      }
      if !value.isEmpty { map[key] = value }
    }
    return map
  }

  public static func saveCredentialMap(
    _ map: [String: String],
    home: URL = FileManager.default.homeDirectoryForCurrentUser
  ) throws {
    let file = credentialsFile(home: home)
    try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    let keys = map.keys.sorted()
    var lines: [String] = []
    for key in keys {
      let value = map[key]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      if !value.isEmpty {
        lines.append("\(key): \(value)")
      }
    }
    let text = lines.isEmpty ? "" : lines.joined(separator: "\n") + "\n"
    try text.write(to: file, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o600],
      ofItemAtPath: file.path
    )
  }

  /// Display-only. Never log the raw key.
  public static func maskedSecret(_ value: String?) -> String? {
    guard let value else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    if trimmed.count <= 8 { return "••••" }
    return String(trimmed.prefix(4)) + "…" + String(trimmed.suffix(4))
  }

  /// `open` of a bundled .app often has no shell PATH. Node and dsh still need Homebrew.
  public static func mergedPath(_ existing: String?) -> String {
    let extras = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
    var parts: [String] = []
    for item in extras + (existing ?? "").split(separator: ":").map(String.init) {
      if !item.isEmpty && !parts.contains(item) {
        parts.append(item)
      }
    }
    return parts.joined(separator: ":")
  }
}
