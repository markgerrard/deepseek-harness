import Foundation

/// App-owned chat history, one JSON file per bot session.
public struct TranscriptStore: Sendable {
  public let directory: URL
  public let workspace: URL?
  public let dshHome: URL?

  public init(directory: URL, workspace: URL? = nil, dshHome: URL? = nil) {
    self.directory = directory
    self.workspace = workspace
    self.dshHome = dshHome
  }

  public func load(sessionId: String) -> [SessionEventDTO] {
    let url = fileURL(for: sessionId)
    guard let data = try? Data(contentsOf: url) else { return [] }
    return (try? JSONDecoder().decode([SessionEventDTO].self, from: data)) ?? []
  }

  public func save(sessionId: String, events: [SessionEventDTO]) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(events)
    let url = fileURL(for: sessionId)
    let temp = directory.appendingPathComponent(".\(url.lastPathComponent).tmp.\(UUID().uuidString)")
    try data.write(to: temp)
    if FileManager.default.fileExists(atPath: url.path) {
      _ = try FileManager.default.replaceItemAt(url, withItemAt: temp, backupItemName: nil, options: [])
    } else {
      try FileManager.default.moveItem(at: temp, to: url)
    }
  }

  /// App JSON first; if empty, import the harness session log once.
  public func loadOrImport(sessionId: String) -> [SessionEventDTO] {
    let existing = load(sessionId: sessionId)
    if !existing.isEmpty { return existing }
    let imported = importHarnessLog(sessionId: sessionId)
    if !imported.isEmpty {
      try? save(sessionId: sessionId, events: imported)
    }
    return imported
  }

  public func importHarnessLog(sessionId: String) -> [SessionEventDTO] {
    guard let workspace else { return [] }
    let home = dshHome
      ?? ProcessInfo.processInfo.environment["DSH_HOME"].map { URL(fileURLWithPath: $0) }
      ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".dsh")
    let dir = home
      .appendingPathComponent("sessions")
      .appendingPathComponent(harnessProjectKey(workspace.path))
      .appendingPathComponent(harnessEncodeSegment(sessionId))
    let plain = dir.appendingPathComponent("session.jsonl")
    let zstd = dir.appendingPathComponent("session.jsonl.zstd")
    let data: Data?
    if FileManager.default.fileExists(atPath: plain.path) {
      data = try? Data(contentsOf: plain)
    } else if FileManager.default.fileExists(atPath: zstd.path) {
      data = decompressZstdFile(zstd)
    } else {
      data = nil
    }
    guard let data, let text = String(data: data, encoding: .utf8) else { return [] }
    return parseHarnessEventLines(text)
  }

  private func fileURL(for sessionId: String) -> URL {
    directory.appendingPathComponent("\(harnessEncodeSegment(sessionId)).json")
  }
}

public func harnessEncodeSegment(_ raw: String) -> String {
  if raw.isEmpty { return "empty" }
  if raw == "." { return "~002E" }
  if raw == ".." { return "~002E~002E" }
  var out = ""
  for scalar in raw.unicodeScalars {
    let ch = Character(scalar)
    if ch != "~", ch.isASCII, (ch.isLetter || ch.isNumber || ch == "." || ch == "_" || ch == "-") {
      out.append(ch)
    } else {
      out.append("~")
      out.append(String(format: "%04X", scalar.value))
    }
  }
  return out
}

public func harnessProjectKey(_ cwd: String) -> String {
  var readable = ""
  var separatorRun = false
  for scalar in cwd.unicodeScalars {
    let ch = Character(scalar)
    if ch == "/" || ch == "\\" || ch == ":" {
      if !separatorRun { readable.append("-") }
      separatorRun = true
    } else if ch != "~", ch.isASCII, (ch.isLetter || ch.isNumber || ch == "." || ch == "_" || ch == "-") {
      readable.append(ch)
      separatorRun = false
    } else {
      readable.append("~")
      readable.append(String(format: "%04X", scalar.value))
      separatorRun = false
    }
  }
  while readable.hasPrefix("-") { readable.removeFirst() }
  let slug = readable.isEmpty ? "root" : String(readable.prefix(251))
  return "--\(slug)--"
}

func parseHarnessEventLines(_ text: String) -> [SessionEventDTO] {
  let decoder = JSONDecoder()
  var events: [SessionEventDTO] = []
  for line in text.split(whereSeparator: \.isNewline) {
    let raw = String(line)
    guard let data = raw.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          obj["type"] as? String != "session",
          obj["seq"] != nil,
          let dto = try? decoder.decode(SessionEventDTO.self, from: data)
    else { continue }
    events.append(dto)
  }
  return events
}

private func decompressZstdFile(_ url: URL) -> Data? {
  let binaries = ["/opt/homebrew/bin/zstd", "/usr/local/bin/zstd", "/usr/bin/zstd"]
  if let bin = binaries.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: bin)
    process.arguments = ["-d", "-c", "--", url.path]
    let stdout = Pipe()
    process.standardOutput = stdout
    process.standardError = FileHandle.nullDevice
    do {
      try process.run()
      let data = stdout.fileHandleForReading.readDataToEndOfFile()
      process.waitUntilExit()
      if process.terminationStatus == 0, !data.isEmpty { return data }
    } catch {}
  }
  return nil
}
