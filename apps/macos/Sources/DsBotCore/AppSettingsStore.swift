import Foundation

public struct AppSettings: Codable, Equatable, Sendable {
  public var chatSurface: ChatSurface

  enum CodingKeys: String, CodingKey {
    case chatSurface
  }

  public init(chatSurface: ChatSurface = .simple) {
    self.chatSurface = chatSurface
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    chatSurface = try c.decodeIfPresent(ChatSurface.self, forKey: .chatSurface) ?? .simple
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
