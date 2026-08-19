import Foundation

public struct Bot: Codable, Equatable, Identifiable, Sendable {
  public var id: String
  public var displayName: String
  public var provider: String
  public var model: String
  public var reasoningEffort: String
  public var threadIDs: [String]

  public init(
    id: String,
    displayName: String,
    provider: String,
    model: String,
    reasoningEffort: String = "off",
    threadIDs: [String] = []
  ) {
    self.id = id
    self.displayName = displayName
    self.provider = provider
    self.model = model
    self.reasoningEffort = reasoningEffort
    self.threadIDs = threadIDs
  }
}

public struct Thread: Codable, Equatable, Identifiable, Sendable {
  public var id: String
  public var botID: String
  public var title: String
  public var createdAt: Date

  public init(
    id: String,
    botID: String,
    title: String,
    createdAt: Date = Date()
  ) {
    self.id = id
    self.botID = botID
    self.title = title
    self.createdAt = createdAt
  }
}

public enum BotStoreError: Error, Equatable, LocalizedError, Sendable {
  case botNotFound(String)
  case duplicateBot(String)
  case duplicateThread(String)

  public var errorDescription: String? {
    switch self {
    case .botNotFound(let id):
      return "Bot with id '\(id)' not found"
    case .duplicateBot(let id):
      return "Bot with id '\(id)' already exists"
    case .duplicateThread(let id):
      return "Thread with id '\(id)' already exists"
    }
  }
}

public struct BotStore: Sendable {
  private struct PersistedState: Codable {
    var bots: [Bot]
    var threads: [Thread]
  }

  public let fileURL: URL
  public private(set) var bots: [Bot]
  private var storedThreads: [Thread]

  public init(fileURL: URL) {
    self.fileURL = fileURL
    if FileManager.default.fileExists(atPath: fileURL.path),
       let data = try? Data(contentsOf: fileURL) {
      let decoder = JSONDecoder()
      decoder.dateDecodingStrategy = .iso8601
      if let state = try? decoder.decode(PersistedState.self, from: data) {
        self.bots = state.bots
        self.storedThreads = state.threads
        return
      }
    }
    self.bots = []
    self.storedThreads = []
  }

  public mutating func addBot(_ bot: Bot) throws {
    if bots.contains(where: { $0.id == bot.id }) {
      throw BotStoreError.duplicateBot(bot.id)
    }
    bots.append(bot)
    try persist()
  }

  public mutating func addThread(_ thread: Thread) throws {
    if storedThreads.contains(where: { $0.id == thread.id }) {
      throw BotStoreError.duplicateThread(thread.id)
    }
    guard let botIndex = bots.firstIndex(where: { $0.id == thread.botID }) else {
      throw BotStoreError.botNotFound(thread.botID)
    }
    storedThreads.append(thread)
    if !bots[botIndex].threadIDs.contains(thread.id) {
      bots[botIndex].threadIDs.append(thread.id)
    }
    try persist()
  }

  public func threads(forBot id: String) -> [Thread] {
    storedThreads.filter { $0.botID == id }
  }

  public func bot(forThread sessionID: String) -> Bot? {
    if let thread = storedThreads.first(where: { $0.id == sessionID }) {
      return bots.first(where: { $0.id == thread.botID })
    }
    return bots.first(where: { $0.threadIDs.contains(sessionID) })
  }

  private func persist() throws {
    let parentDir = fileURL.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: parentDir, withIntermediateDirectories: true)

    let tempURL = parentDir.appendingPathComponent(".\(fileURL.lastPathComponent).tmp.\(UUID().uuidString)")
    defer {
      try? FileManager.default.removeItem(at: tempURL)
    }

    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

    let state = PersistedState(bots: bots, threads: storedThreads)
    let data = try encoder.encode(state)
    try data.write(to: tempURL)

    if FileManager.default.fileExists(atPath: fileURL.path) {
      _ = try FileManager.default.replaceItemAt(fileURL, withItemAt: tempURL, backupItemName: nil, options: [])
    } else {
      try FileManager.default.moveItem(at: tempURL, to: fileURL)
    }
  }
}
