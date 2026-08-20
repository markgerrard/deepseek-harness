import Foundation
import XCTest
@testable import DsBotCore

final class BotStoreTests: XCTestCase {
  private func temporaryStoreURL() -> URL {
    FileManager.default.temporaryDirectory
      .appendingPathComponent("botstore-test-\(UUID().uuidString).json")
  }

  func testBotDecodesWithoutAvatarPath() throws {
    let json = Data(#"""
      {"id":"a","displayName":"A","provider":"p","model":"m","reasoningEffort":"off","threadIDs":[]}
      """#.utf8)
    let bot = try JSONDecoder().decode(Bot.self, from: json)
    XCTAssertNil(bot.avatarPath)
    XCTAssertEqual(bot.id, "a")
    XCTAssertFalse(bot.pinned)
    XCTAssertEqual(bot.job, "")
    XCTAssertNil(bot.chatSurface)
    XCTAssertNil(bot.blobShape)
    XCTAssertNil(bot.blobColorIndex)
    XCTAssertEqual(bot.title, "")
    XCTAssertFalse(bot.notificationsEnabled)
  }

  func testBotDecodesWithoutPinnedDefaultsFalse() throws {
    let json = Data(#"""
      {"id":"a","displayName":"A","provider":"p","model":"m","reasoningEffort":"off","threadIDs":[]}
      """#.utf8)
    let bot = try JSONDecoder().decode(Bot.self, from: json)
    XCTAssertFalse(bot.pinned)
  }

  func testSetPinnedPersistsAndRoundTrips() throws {
    let fileURL = temporaryStoreURL()
    defer { try? FileManager.default.removeItem(at: fileURL) }

    var store = BotStore(fileURL: fileURL)
    try store.addBot(Bot(
      id: "bot-a",
      displayName: "Bot A",
      provider: "p",
      model: "m"
    ))
    XCTAssertFalse(store.bots[0].pinned)

    try store.setPinned(botID: "bot-a", pinned: true)
    XCTAssertTrue(store.bots[0].pinned)

    let reloaded = BotStore(fileURL: fileURL)
    XCTAssertEqual(reloaded.bots.count, 1)
    XCTAssertTrue(reloaded.bots[0].pinned)

    var store2 = reloaded
    try store2.setPinned(botID: "bot-a", pinned: false)
    XCTAssertFalse(store2.bots[0].pinned)
    XCTAssertFalse(BotStore(fileURL: fileURL).bots[0].pinned)
  }

  func testSetPinnedUnknownBotThrows() throws {
    let fileURL = temporaryStoreURL()
    defer { try? FileManager.default.removeItem(at: fileURL) }
    var store = BotStore(fileURL: fileURL)
    XCTAssertThrowsError(try store.setPinned(botID: "missing", pinned: true)) { error in
      guard let storeError = error as? BotStoreError else {
        return XCTFail("Expected BotStoreError, got \(error)")
      }
      XCTAssertEqual(storeError, .botNotFound("missing"))
    }
  }

  func testOneBotOwnsManyThreadsAndDoesNotLeak() throws {
    let fileURL = temporaryStoreURL()
    defer { try? FileManager.default.removeItem(at: fileURL) }

    var store = BotStore(fileURL: fileURL)

    let botA = Bot(
      id: "bot-a",
      displayName: "Bot A",
      provider: "deepseek",
      model: "deepseek-chat",
      reasoningEffort: "off"
    )
    let botB = Bot(
      id: "bot-b",
      displayName: "Bot B",
      provider: "deepseek",
      model: "deepseek-reasoner",
      reasoningEffort: "high"
    )

    try store.addBot(botA)
    try store.addBot(botB)

    let thread1 = Thread(id: "s1", botID: "bot-a", title: "Session 1", createdAt: Date())
    let thread2 = Thread(id: "s2", botID: "bot-a", title: "Session 2", createdAt: Date())
    let thread3 = Thread(id: "s3", botID: "bot-b", title: "Session 3", createdAt: Date())

    try store.addThread(thread1)
    try store.addThread(thread2)
    try store.addThread(thread3)

    XCTAssertEqual(store.threads(forBot: "bot-a").map(\.id), ["s1", "s2"])
    XCTAssertEqual(store.threads(forBot: "bot-b").map(\.id), ["s3"])
    XCTAssertEqual(store.bot(forThread: "s1")?.id, "bot-a")
    XCTAssertEqual(store.bot(forThread: "s2")?.id, "bot-a")
    XCTAssertEqual(store.bot(forThread: "s3")?.id, "bot-b")
    XCTAssertFalse(store.threads(forBot: "bot-a").map(\.id).contains("s3"))

    let store2 = BotStore(fileURL: fileURL)
    XCTAssertEqual(store2.threads(forBot: "bot-a").map(\.id), ["s1", "s2"])
    XCTAssertEqual(store2.threads(forBot: "bot-b").map(\.id), ["s3"])
    XCTAssertEqual(store2.bot(forThread: "s1")?.id, "bot-a")
    XCTAssertEqual(store2.bot(forThread: "s2")?.id, "bot-a")
    XCTAssertEqual(store2.bot(forThread: "s3")?.id, "bot-b")
    XCTAssertFalse(store2.threads(forBot: "bot-a").map(\.id).contains("s3"))
  }

  func testAddThreadForUnknownBotThrows() throws {
    let fileURL = temporaryStoreURL()
    defer { try? FileManager.default.removeItem(at: fileURL) }

    var store = BotStore(fileURL: fileURL)
    let thread = Thread(id: "s1", botID: "unknown-bot", title: "Session 1")

    XCTAssertThrowsError(try store.addThread(thread)) { error in
      guard let storeError = error as? BotStoreError else {
        return XCTFail("Expected BotStoreError, got \(error)")
      }
      XCTAssertEqual(storeError, .botNotFound("unknown-bot"))
    }
  }

  func testAddDuplicateBotThrows() throws {
    let fileURL = temporaryStoreURL()
    defer { try? FileManager.default.removeItem(at: fileURL) }

    var store = BotStore(fileURL: fileURL)
    let bot = Bot(
      id: "bot-a",
      displayName: "Bot A",
      provider: "deepseek",
      model: "deepseek-chat"
    )

    try store.addBot(bot)

    XCTAssertThrowsError(try store.addBot(bot)) { error in
      guard let storeError = error as? BotStoreError else {
        return XCTFail("Expected BotStoreError, got \(error)")
      }
      XCTAssertEqual(storeError, .duplicateBot("bot-a"))
    }
  }

  func testAddDuplicateThreadThrows() throws {
    let fileURL = temporaryStoreURL()
    defer { try? FileManager.default.removeItem(at: fileURL) }

    var store = BotStore(fileURL: fileURL)
    let bot = Bot(
      id: "bot-a",
      displayName: "Bot A",
      provider: "deepseek",
      model: "deepseek-chat"
    )

    try store.addBot(bot)

    let thread = Thread(id: "s1", botID: "bot-a", title: "Session 1")
    try store.addThread(thread)

    XCTAssertThrowsError(try store.addThread(thread)) { error in
      guard let storeError = error as? BotStoreError else {
        return XCTFail("Expected BotStoreError, got \(error)")
      }
      XCTAssertEqual(storeError, .duplicateThread("s1"))
    }
  }

  func testMissingFileInitializesEmpty() {
    let fileURL = temporaryStoreURL()
    let store = BotStore(fileURL: fileURL)

    XCTAssertTrue(store.threads(forBot: "bot-a").isEmpty)
    XCTAssertNil(store.bot(forThread: "s1"))
  }

  func testDateRoundTrip() throws {
    let fileURL = temporaryStoreURL()
    defer { try? FileManager.default.removeItem(at: fileURL) }

    var store = BotStore(fileURL: fileURL)
    let bot = Bot(
      id: "bot-a",
      displayName: "Bot A",
      provider: "deepseek",
      model: "deepseek-chat"
    )
    try store.addBot(bot)

    let isoFormatter = ISO8601DateFormatter()
    let date = try XCTUnwrap(isoFormatter.date(from: "2026-08-19T12:34:56Z"))
    let thread = Thread(id: "s1", botID: "bot-a", title: "Session 1", createdAt: date)
    try store.addThread(thread)

    let store2 = BotStore(fileURL: fileURL)
    let threads = store2.threads(forBot: "bot-a")
    XCTAssertEqual(threads.count, 1)
    XCTAssertEqual(threads.first?.id, "s1")
    XCTAssertEqual(threads.first?.createdAt, date)
  }

  func testBotForUnknownThreadReturnsNil() throws {
    let fileURL = temporaryStoreURL()
    defer { try? FileManager.default.removeItem(at: fileURL) }

    let store = BotStore(fileURL: fileURL)
    XCTAssertNil(store.bot(forThread: "unknown-session"))
  }

  func testUpdateBotPersistsJobAndKeepsPin() throws {
    let fileURL = temporaryStoreURL()
    defer { try? FileManager.default.removeItem(at: fileURL) }
    var store = BotStore(fileURL: fileURL)
    try store.addBot(Bot(id: "bot-a", displayName: "A", provider: "p", model: "m", job: "old"))
    try store.setPinned(botID: "bot-a", pinned: true)
    try store.updateBot(
      id: "bot-a",
      displayName: "Alpha",
      title: "Scout",
      job: "new job",
      provider: "cline-pass",
      model: "cline-pass/deepseek-v4-pro",
      reasoningEffort: "high"
    )
    XCTAssertEqual(store.bots[0].displayName, "Alpha")
    XCTAssertEqual(store.bots[0].title, "Scout")
    XCTAssertEqual(store.bots[0].job, "new job")
    XCTAssertEqual(store.bots[0].model, "cline-pass/deepseek-v4-pro")
    XCTAssertTrue(store.bots[0].pinned)
    let reloaded = BotStore(fileURL: fileURL)
    XCTAssertEqual(reloaded.bots[0].job, "new job")
    XCTAssertTrue(reloaded.bots[0].pinned)
    XCTAssertNil(reloaded.bots[0].chatSurface)
    XCTAssertEqual(reloaded.bots[0].title, "Scout")
  }

  func testSetNotificationsEnabledPersists() throws {
    let fileURL = temporaryStoreURL()
    defer { try? FileManager.default.removeItem(at: fileURL) }
    var store = BotStore(fileURL: fileURL)
    try store.addBot(Bot(id: "bot-a", displayName: "A", provider: "p", model: "m"))
    XCTAssertFalse(store.bots[0].notificationsEnabled)
    try store.setNotificationsEnabled(botID: "bot-a", enabled: true)
    XCTAssertTrue(store.bots[0].notificationsEnabled)
    XCTAssertTrue(BotStore(fileURL: fileURL).bots[0].notificationsEnabled)
  }

  func testSetChatSurfacePersistsAndRoundTrips() throws {
    let fileURL = temporaryStoreURL()
    defer { try? FileManager.default.removeItem(at: fileURL) }
    var store = BotStore(fileURL: fileURL)
    try store.addBot(Bot(id: "bot-a", displayName: "A", provider: "p", model: "m"))
    XCTAssertNil(store.bots[0].chatSurface)

    try store.setChatSurface(botID: "bot-a", chatSurface: .advanced)
    XCTAssertEqual(store.bots[0].chatSurface, .advanced)
    XCTAssertEqual(BotStore(fileURL: fileURL).bots[0].chatSurface, .advanced)

    try store.setChatSurface(botID: "bot-a", chatSurface: nil)
    XCTAssertNil(store.bots[0].chatSurface)
    XCTAssertNil(BotStore(fileURL: fileURL).bots[0].chatSurface)
  }

  func testSetBlobLookPersistsAndResetClears() throws {
    let fileURL = temporaryStoreURL()
    defer { try? FileManager.default.removeItem(at: fileURL) }
    var store = BotStore(fileURL: fileURL)
    try store.addBot(Bot(id: "bot-a", displayName: "A", provider: "p", model: "m"))
    XCTAssertNil(store.bots[0].blobShape)

    try store.setBlobLook(botID: "bot-a", look: BlobLook(shape: .cloud, colorIndex: 2))
    XCTAssertEqual(store.bots[0].blobShape, .cloud)
    XCTAssertEqual(store.bots[0].blobColorIndex, 2)
    XCTAssertEqual(BotStore(fileURL: fileURL).bots[0].blobShape, .cloud)

    try store.setAvatarPath(botID: "bot-a", path: "/tmp/face.png")
    XCTAssertEqual(store.bots[0].avatarPath, "/tmp/face.png")

    try store.setBlobLook(botID: "bot-a", look: nil)
    try store.setAvatarPath(botID: "bot-a", path: nil)
    XCTAssertNil(store.bots[0].blobShape)
    XCTAssertNil(store.bots[0].blobColorIndex)
    XCTAssertNil(store.bots[0].avatarPath)
    XCTAssertNil(BotStore(fileURL: fileURL).bots[0].blobShape)
  }

  func testRemoveBotDropsItsThreads() throws {
    let fileURL = temporaryStoreURL()
    defer { try? FileManager.default.removeItem(at: fileURL) }
    var store = BotStore(fileURL: fileURL)
    try store.addBot(Bot(id: "bot-a", displayName: "A", provider: "p", model: "m"))
    try store.addThread(Thread(id: "s1", botID: "bot-a", title: "A"))
    try store.removeBot(id: "bot-a")
    XCTAssertTrue(store.bots.isEmpty)
    XCTAssertTrue(store.threads(forBot: "bot-a").isEmpty)
  }
}
