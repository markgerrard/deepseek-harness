import Foundation
import XCTest
@testable import DsBotCore

final class BlobLookTests: XCTestCase {
  func testDerivedLookIsStableForASeed() {
    XCTAssertEqual(BlobLook.derived(from: "mark"), BlobLook.derived(from: "mark"))
  }

  func testCanonicalShapesIncludeWhaleFirst() {
    XCTAssertEqual(BlobShape.allCases.first, .whale)
    XCTAssertEqual(BlobShape.defaultShape, .whale)
    XCTAssertTrue(BlobShape.allCases.contains(.whale))
  }

  func testDerivedLooksSpreadAcrossShapes() {
    let shapes = Set((0..<80).map { BlobLook.derived(from: "bot-\($0)-\($0 * 17)").shape })
    XCTAssertGreaterThanOrEqual(shapes.count, 5)
  }

  func testPaletteHasElevenSwatches() {
    XCTAssertEqual(blobPalette.count, 11)
    XCTAssertEqual(BlobLook.paletteCount, 11)
  }

  func testResolvedLookPrefersStoredOverride() {
    let bot = Bot(
      id: "bot-a",
      displayName: "A",
      provider: "p",
      model: "m",
      blobShape: .triangle,
      blobColorIndex: 6
    )
    XCTAssertEqual(bot.resolvedLook, BlobLook(shape: .triangle, colorIndex: 6))
  }

  func testRandomLookDiffersFromCurrent() {
    let current = BlobLook(shape: .circle, colorIndex: 0)
    for _ in 0..<24 {
      XCTAssertNotEqual(BlobLook.random(excluding: current), current)
    }
  }

  func testWorkingPoseBouncesAndTiltsMoreThanIdle() {
    let times = stride(from: 0.0, through: 2.0, by: 0.05).map { $0 }
    func amp(_ motion: BlobMotion, _ key: (BlobPose) -> Double) -> Double {
      times.map { abs(key(blobPose(motion: motion, time: $0, phase: 0))) }.max() ?? 0
    }
    XCTAssertGreaterThan(amp(.working, \.bounceY), amp(.idle, \.bounceY) * 2)
    XCTAssertGreaterThan(amp(.working, \.tilt), 0.08)
    XCTAssertLessThan(amp(.idle, \.tilt), 0.04)
    let still = blobPose(motion: .still, time: 1.3, phase: 0.4)
    XCTAssertEqual(still.bounceY, 0)
    XCTAssertEqual(still.tilt, 0)
    XCTAssertEqual(still.scaleX, 1)
    XCTAssertEqual(still.scaleY, 1)
    XCTAssertEqual(still.blink, 1)
  }

  func testResolvedLookDefaultsToWhale() {
    let bot = Bot(id: "bot-a", displayName: "A", provider: "p", model: "m")
    XCTAssertEqual(bot.resolvedLook.shape, .whale)
    XCTAssertEqual(bot.resolvedLook.colorIndex, BlobLook.derived(from: "bot-a").colorIndex)
    XCTAssertNil(bot.blobShape)
    XCTAssertNil(bot.blobColorIndex)
  }
}
