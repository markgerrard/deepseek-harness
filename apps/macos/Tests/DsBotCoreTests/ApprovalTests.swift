import Foundation
import XCTest
@testable import DsBotCore

final class ApprovalTests: XCTestCase {
  func testDismissedApprovalIsRejectedNotAllowed() {
    XCTAssertEqual(outcomeForDismissedSheet(), .rejected)
    XCTAssertNotEqual(outcomeForDismissedSheet().rawValue, "allowed-once")
  }

  func testSdkPermissionOutcomeRawValues() {
    XCTAssertEqual(SdkPermissionOutcome.allowedOnce.rawValue, "allowed-once")
    XCTAssertEqual(SdkPermissionOutcome.rejected.rawValue, "rejected")
    XCTAssertEqual(SdkPermissionOutcome.cancelled.rawValue, "cancelled")
    XCTAssertEqual(SdkPermissionOutcome.unavailable.rawValue, "unavailable")
  }

  func testSdkPermissionOutcomeCodable() throws {
    let outcomes: [SdkPermissionOutcome] = [.allowedOnce, .rejected, .cancelled, .unavailable]
    let encoder = JSONEncoder()
    let decoder = JSONDecoder()

    for outcome in outcomes {
      let data = try encoder.encode(outcome)
      let decoded = try decoder.decode(SdkPermissionOutcome.self, from: data)
      XCTAssertEqual(decoded, outcome)
    }
  }
}
