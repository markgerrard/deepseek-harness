import Foundation
import XCTest
@testable import DsBotCore

final class AppSettingsStoreTests: XCTestCase {
  func testMissingFileDefaultsToSimple() {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("settings-missing-\(UUID().uuidString).json")
    let store = AppSettingsStore(fileURL: url)
    XCTAssertEqual(store.settings.chatSurface, .simple)
  }

  func testSetChatSurfacePersists() throws {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("settings-\(UUID().uuidString).json")
    defer { try? FileManager.default.removeItem(at: url) }

    var store = AppSettingsStore(fileURL: url)
    XCTAssertEqual(store.settings.chatSurface, .simple)
    try store.setChatSurface(.advanced)
    XCTAssertEqual(store.settings.chatSurface, .advanced)
    XCTAssertEqual(AppSettingsStore(fileURL: url).settings.chatSurface, .advanced)
  }

  func testMissingFileDefaultsUserNameToMark() {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("settings-missing-\(UUID().uuidString).json")
    let store = AppSettingsStore(fileURL: url)
    XCTAssertEqual(store.settings.userName, "Mark")
  }

  func testSetUserNamePersists() throws {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("settings-\(UUID().uuidString).json")
    defer { try? FileManager.default.removeItem(at: url) }

    var store = AppSettingsStore(fileURL: url)
    try store.setUserName("  Ada  ")
    XCTAssertEqual(store.settings.userName, "Ada")
    XCTAssertEqual(AppSettingsStore(fileURL: url).settings.userName, "Ada")
  }
}
