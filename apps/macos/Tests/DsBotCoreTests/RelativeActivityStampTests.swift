import Foundation
import XCTest
@testable import DsBotCore

final class RelativeActivityStampTests: XCTestCase {
  func testTodayIsClockTime() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let now = Date(timeIntervalSince1970: 1_777_132_260) // 2026-05-01 12:11 UTC-ish
    let sameDay = now.addingTimeInterval(-3600)
    let stamp = relativeActivityStamp(from: sameDay, now: now, calendar: calendar)
    XCTAssertFalse(stamp.contains("/"))
    XCTAssertFalse(stamp == "Yesterday")
  }

  func testYesterdayLabel() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let now = Date(timeIntervalSince1970: 1_777_200_000)
    let yesterday = calendar.date(byAdding: .day, value: -1, to: now)!
    XCTAssertEqual(relativeActivityStamp(from: yesterday, now: now, calendar: calendar), "Yesterday")
  }

  func testOlderThanAWeekIsDayMonth() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let now = Date(timeIntervalSince1970: 1_777_200_000)
    let older = calendar.date(byAdding: .day, value: -20, to: now)!
    let stamp = relativeActivityStamp(from: older, now: now, calendar: calendar)
    XCTAssertTrue(stamp.contains("/"), stamp)
  }
}
