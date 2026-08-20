import Foundation

public struct Bot: Codable, Equatable, Identifiable, Sendable {
  public var id: String
  public var displayName: String
  public var provider: String
  public var model: String
  public var reasoningEffort: String
  /// Short role line in Settings (Grok Bot "Title"). Empty on older bots.
  public var title: String
  /// Job / persona text shown in Settings as Description. Empty on bots created before this field.
  public var job: String
  public var threadIDs: [String]
  /// User-pinned bots show as blobs at the top of the sidebar. Default false; old JSON omits it.
  public var pinned: Bool
  /// Absolute file path to a PNG, JPEG, or looping GIF. Nil uses a generated blob.
  public var avatarPath: String?
  /// Nil follows the account Simple/Advanced default.
  public var chatSurface: ChatSurface?
  /// Nil uses the seed-derived silhouette.
  public var blobShape: BlobShape?
  /// Nil uses the seed-derived palette index.
  public var blobColorIndex: Int?
  public var notificationsEnabled: Bool

  enum CodingKeys: String, CodingKey {
    case id, displayName, provider, model, reasoningEffort, title, job, threadIDs, pinned, avatarPath, chatSurface
    case blobShape, blobColorIndex, notificationsEnabled
  }

  public init(
    id: String,
    displayName: String,
    provider: String,
    model: String,
    reasoningEffort: String = "off",
    title: String = "",
    job: String = "",
    threadIDs: [String] = [],
    pinned: Bool = false,
    avatarPath: String? = nil,
    chatSurface: ChatSurface? = nil,
    blobShape: BlobShape? = nil,
    blobColorIndex: Int? = nil,
    notificationsEnabled: Bool = false
  ) {
    self.id = id
    self.displayName = displayName
    self.provider = provider
    self.model = model
    self.reasoningEffort = reasoningEffort
    self.title = title
    self.job = job
    self.threadIDs = threadIDs
    self.pinned = pinned
    self.avatarPath = avatarPath
    self.chatSurface = chatSurface
    self.blobShape = blobShape
    self.blobColorIndex = blobColorIndex
    self.notificationsEnabled = notificationsEnabled
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    displayName = try c.decode(String.self, forKey: .displayName)
    provider = try c.decode(String.self, forKey: .provider)
    model = try c.decode(String.self, forKey: .model)
    reasoningEffort = try c.decode(String.self, forKey: .reasoningEffort)
    title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
    job = try c.decodeIfPresent(String.self, forKey: .job) ?? ""
    threadIDs = try c.decodeIfPresent([String].self, forKey: .threadIDs) ?? []
    pinned = try c.decodeIfPresent(Bool.self, forKey: .pinned) ?? false
    avatarPath = try c.decodeIfPresent(String.self, forKey: .avatarPath)
    chatSurface = try c.decodeIfPresent(ChatSurface.self, forKey: .chatSurface)
    blobShape = try c.decodeIfPresent(BlobShape.self, forKey: .blobShape)
    blobColorIndex = try c.decodeIfPresent(Int.self, forKey: .blobColorIndex)
    notificationsEnabled = try c.decodeIfPresent(Bool.self, forKey: .notificationsEnabled) ?? false
  }

  public var resolvedLook: BlobLook {
    let derived = BlobLook.derived(from: id)
    return BlobLook(
      shape: blobShape ?? .whale,
      colorIndex: blobColorIndex ?? derived.colorIndex
    )
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

  public mutating func setPinned(botID: String, pinned: Bool) throws {
    guard let index = bots.firstIndex(where: { $0.id == botID }) else {
      throw BotStoreError.botNotFound(botID)
    }
    bots[index].pinned = pinned
    try persist()
  }

  public mutating func setChatSurface(botID: String, chatSurface: ChatSurface?) throws {
    guard let index = bots.firstIndex(where: { $0.id == botID }) else {
      throw BotStoreError.botNotFound(botID)
    }
    bots[index].chatSurface = chatSurface
    try persist()
  }

  public mutating func setBlobLook(botID: String, look: BlobLook?) throws {
    guard let index = bots.firstIndex(where: { $0.id == botID }) else {
      throw BotStoreError.botNotFound(botID)
    }
    bots[index].blobShape = look?.shape
    bots[index].blobColorIndex = look?.colorIndex
    try persist()
  }

  public mutating func setAvatarPath(botID: String, path: String?) throws {
    guard let index = bots.firstIndex(where: { $0.id == botID }) else {
      throw BotStoreError.botNotFound(botID)
    }
    bots[index].avatarPath = path
    try persist()
  }

  public mutating func setNotificationsEnabled(botID: String, enabled: Bool) throws {
    guard let index = bots.firstIndex(where: { $0.id == botID }) else {
      throw BotStoreError.botNotFound(botID)
    }
    bots[index].notificationsEnabled = enabled
    try persist()
  }

  public mutating func updateBot(
    id: String,
    displayName: String,
    title: String = "",
    job: String,
    provider: String,
    model: String,
    reasoningEffort: String
  ) throws {
    guard let index = bots.firstIndex(where: { $0.id == id }) else {
      throw BotStoreError.botNotFound(id)
    }
    bots[index].displayName = displayName
    bots[index].title = title
    bots[index].job = job
    bots[index].provider = provider
    bots[index].model = model
    bots[index].reasoningEffort = reasoningEffort
    try persist()
  }

  public mutating func removeBot(id: String) throws {
    guard bots.contains(where: { $0.id == id }) else {
      throw BotStoreError.botNotFound(id)
    }
    bots.removeAll { $0.id == id }
    storedThreads.removeAll { $0.botID == id }
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
