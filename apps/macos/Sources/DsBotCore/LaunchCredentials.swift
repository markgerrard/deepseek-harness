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
    if env["CLINE_API_KEY"]?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true {
      if let key = clineApiKey(environment: base, home: home) {
        env["CLINE_API_KEY"] = key
      }
    }
    return env
  }
}
