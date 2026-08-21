import Foundation

/// A file copied into the shared workspace: one computer, all Bots
/// can read `/workspace`. The chat that attached it still shows the chip.
public struct ChatAttachment: Codable, Equatable, Identifiable, Sendable {
  public var id: String
  public var originalName: String
  public var relativePath: String
  public var byteCount: Int

  public init(
    id: String = UUID().uuidString,
    originalName: String,
    relativePath: String,
    byteCount: Int
  ) {
    self.id = id
    self.originalName = originalName
    self.relativePath = relativePath
    self.byteCount = byteCount
  }
}

public enum AttachmentStoreError: Error, Equatable, LocalizedError, Sendable {
  case noWorkspace
  case tooMany
  case tooLarge(String)
  case unreadable(String)

  public var errorDescription: String? {
    switch self {
    case .noWorkspace:
      return "Shared workspace is not available"
    case .tooMany:
      return "Up to \(AttachmentStore.maxCount) files per message"
    case .tooLarge(let name):
      return "\(name) is over 25 MB"
    case .unreadable(let name):
      return "Could not read \(name)"
    }
  }
}

public enum AttachmentStore: Sendable {
  public static let maxCount = 6
  public static let maxBytes = 25 * 1024 * 1024
  public static let folderName = "uploads"

  public static func ingest(urls: [URL], workspace: URL) throws -> [ChatAttachment] {
    if urls.count > maxCount { throw AttachmentStoreError.tooMany }
    let uploads = workspace.appendingPathComponent(folderName, isDirectory: true)
    try FileManager.default.createDirectory(at: uploads, withIntermediateDirectories: true)
    var result: [ChatAttachment] = []
    for url in urls {
      let name = url.lastPathComponent
      let data: Data
      do {
        data = try readPickedFile(url)
      } catch {
        throw AttachmentStoreError.unreadable(name)
      }
      if data.count > maxBytes { throw AttachmentStoreError.tooLarge(name) }
      let storedName = uniqueFileName(name, in: uploads)
      let dest = uploads.appendingPathComponent(storedName)
      do {
        try data.write(to: dest, options: .atomic)
      } catch {
        throw AttachmentStoreError.unreadable(name)
      }
      result.append(
        ChatAttachment(
          originalName: name,
          relativePath: "\(folderName)/\(storedName)",
          byteCount: data.count
        )
      )
    }
    return result
  }

  public static func uniqueFileName(_ name: String, in directory: URL) -> String {
    let ns = name as NSString
    let base = ns.deletingPathExtension
    let ext = ns.pathExtension
    var candidate = name
    var n = 2
    while FileManager.default.fileExists(atPath: directory.appendingPathComponent(candidate).path) {
      if ext.isEmpty {
        candidate = "\(base)-\(n)"
      } else {
        candidate = "\(base)-\(n).\(ext)"
      }
      n += 1
    }
    return candidate
  }

  public static func promptSuffix(for attachments: [ChatAttachment]) -> String {
    guard !attachments.isEmpty else { return "" }
    let lines = attachments.map { "- \($0.relativePath)" }.joined(separator: "\n")
    return """

    Attached files are already in your working directory. Read them with filesystem tools using these relative paths:
    \(lines)
    """
  }

  /// fileImporter URLs are security-scoped; `fileSize` and `copyItem` often fail.
  private static func readPickedFile(_ url: URL) throws -> Data {
    let accessed = url.startAccessingSecurityScopedResource()
    defer {
      if accessed { url.stopAccessingSecurityScopedResource() }
    }
    var data: Data?
    var coordinatorError: NSError?
    NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinatorError) { coordinated in
      data = try? Data(contentsOf: coordinated)
    }
    if let data { return data }
    if let data = try? Data(contentsOf: url) { return data }
    if let coordinatorError { throw coordinatorError }
    throw AttachmentStoreError.unreadable(url.lastPathComponent)
  }
}

extension ChatAttachment {
  public var jsonValue: JSONValue {
    .object([
      "id": .string(id),
      "originalName": .string(originalName),
      "relativePath": .string(relativePath),
      "byteCount": .number(Double(byteCount)),
    ])
  }

  public static func list(from value: JSONValue?) -> [ChatAttachment] {
    guard let items = value?.arrayValue else { return [] }
    return items.compactMap { item in
      guard let id = item["id"]?.stringValue,
            let originalName = item["originalName"]?.stringValue,
            let relativePath = item["relativePath"]?.stringValue
      else { return nil }
      let bytes = item["byteCount"]?.intValue ?? 0
      return ChatAttachment(
        id: id,
        originalName: originalName,
        relativePath: relativePath,
        byteCount: bytes
      )
    }
  }
}
