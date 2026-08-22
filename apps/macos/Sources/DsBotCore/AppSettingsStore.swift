import Foundation

public struct AppSettings: Codable, Equatable, Sendable {
  public var chatSurface: ChatSurface
  /// Display name of the local user; drives the sidebar avatar and initial.
  public var userName: String

  enum CodingKeys: String, CodingKey {
    case chatSurface
    case userName
  }

  public init(chatSurface: ChatSurface = .simple, userName: String = "Mark") {
    self.chatSurface = chatSurface
    self.userName = userName
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    chatSurface = try c.decodeIfPresent(ChatSurface.self, forKey: .chatSurface) ?? .simple
    userName = try c.decodeIfPresent(String.self, forKey: .userName) ?? "Mark"
  }
}

public struct AppSettingsStore: Sendable {
  public let fileURL: URL?
  public private(set) var settings: AppSettings

  public init(fileURL: URL?) {
    self.fileURL = fileURL
    if let fileURL,
       let data = try? Data(contentsOf: fileURL),
       let decoded = try? JSONDecoder().decode(AppSettings.self, from: data) {
      self.settings = decoded
    } else {
      self.settings = AppSettings()
    }
  }

  public mutating func setChatSurface(_ surface: ChatSurface) throws {
    settings.chatSurface = surface
    try persist()
  }

  /// Stores the name trimmed; a blank result falls back to the default so the
  /// avatar always has an initial to show.
  public mutating func setUserName(_ name: String) throws {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    settings.userName = trimmed.isEmpty ? "Mark" : trimmed
    try persist()
  }

  private func persist() throws {
    guard let fileURL else { return }
    let parent = fileURL.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(settings)
    try data.write(to: fileURL, options: .atomic)
  }
}
