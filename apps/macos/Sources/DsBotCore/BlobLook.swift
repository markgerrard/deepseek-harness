import Foundation

public enum BlobShape: String, Codable, Equatable, Sendable, Hashable, CaseIterable {
  case whale
  case circle
  case oval
  case squircle
  case pill
  case triangle
  case cube
  case cloud
  case drop

  public static let defaultShape: BlobShape = .whale
}

public struct BlobRGB: Equatable, Sendable {
  public var r: Double
  public var g: Double
  public var b: Double

  public init(r: Double, g: Double, b: Double) {
    self.r = r
    self.g = g
    self.b = b
  }
}

public let blobPalette: [BlobRGB] = [
  BlobRGB(r: 0.96, g: 0.96, b: 0.97),
  BlobRGB(r: 0.62, g: 0.42, b: 0.28),
  BlobRGB(r: 0.94, g: 0.27, b: 0.32),
  BlobRGB(r: 1.00, g: 0.55, b: 0.16),
  BlobRGB(r: 0.98, g: 0.78, b: 0.18),
  BlobRGB(r: 0.22, g: 0.78, b: 0.38),
  BlobRGB(r: 0.18, g: 0.78, b: 0.72),
  BlobRGB(r: 0.22, g: 0.48, b: 0.98),
  BlobRGB(r: 0.55, g: 0.36, b: 0.96),
  BlobRGB(r: 0.95, g: 0.38, b: 0.62),
  BlobRGB(r: 0.62, g: 0.64, b: 0.68),
]

public struct BlobLook: Equatable, Sendable, Codable {
  public var shape: BlobShape
  public var colorIndex: Int

  public static let paletteCount = 11

  public init(shape: BlobShape, colorIndex: Int) {
    self.shape = shape
    let count = max(blobPalette.count, 1)
    self.colorIndex = ((colorIndex % count) + count) % count
  }

  public var color: BlobRGB {
    blobPalette[colorIndex]
  }

  public static func derived(from seed: String) -> BlobLook {
    let hash = fnv(seed)
    let shapes = BlobShape.allCases
    return BlobLook(
      shape: shapes[hash % shapes.count],
      colorIndex: (hash / max(shapes.count, 1)) % paletteCount
    )
  }

  public static func random(excluding current: BlobLook? = nil) -> BlobLook {
    let shapes = BlobShape.allCases
    for _ in 0..<16 {
      let next = BlobLook(
        shape: shapes[Int.random(in: 0..<shapes.count)],
        colorIndex: Int.random(in: 0..<paletteCount)
      )
      if next != current { return next }
    }
    return BlobLook(shape: .whale, colorIndex: 6)
  }
}

public enum BlobMotion: Equatable, Sendable {
  case still
  case idle
  case energetic
  case working
}

public struct BlobPose: Equatable, Sendable {
  public var bounceY: Double
  public var scaleX: Double
  public var scaleY: Double
  public var tilt: Double
  public var blink: Double

  public init(bounceY: Double, scaleX: Double, scaleY: Double, tilt: Double, blink: Double) {
    self.bounceY = bounceY
    self.scaleX = scaleX
    self.scaleY = scaleY
    self.tilt = tilt
    self.blink = blink
  }
}

public func blobPose(motion: BlobMotion, time: Double, phase: Double) -> BlobPose {
  let t = time + phase
  let blinkPeriod = motion == .working ? 2.1 : 3.6
  let cycle = t.truncatingRemainder(dividingBy: blinkPeriod)
  let blink: Double = {
    if cycle < 0.14 {
      return cycle < 0.07 ? 1 - cycle / 0.07 : (cycle - 0.07) / 0.07
    }
    return 1
  }()

  switch motion {
  case .still:
    return BlobPose(bounceY: 0, scaleX: 1, scaleY: 1, tilt: 0, blink: 1)
  case .idle:
    return BlobPose(
      bounceY: 0.018 * sin(t * 2.05),
      scaleX: 1 + 0.02 * sin(t * 1.45),
      scaleY: 1 - 0.018 * sin(t * 1.45) + 0.02 * sin(t * 2.05),
      tilt: 0,
      blink: max(0.08, blink)
    )
  case .energetic:
    return BlobPose(
      bounceY: 0.035 * sin(t * 2.7),
      scaleX: 1 + 0.03 * sin(t * 1.7),
      scaleY: 1 - 0.025 * sin(t * 1.7) + 0.03 * sin(t * 2.7),
      tilt: 0.03 * sin(t * 1.9),
      blink: max(0.08, blink)
    )
  case .working:
    let hop = sin(t * 6.0)
    return BlobPose(
      bounceY: 0.11 * hop,
      scaleX: 1 + 0.16 * sin(t * 6.0 + .pi / 2),
      scaleY: 1 - 0.12 * sin(t * 6.0 + .pi / 2),
      tilt: 0.20 * sin(t * 4.2),
      blink: max(0.08, blink)
    )
  }
}

private func fnv(_ seed: String) -> Int {
  var hash: UInt64 = 1_469_598_103_934_665_603
  for byte in seed.utf8 {
    hash ^= UInt64(byte)
    hash = hash &* 1_099_511_628_211
  }
  return Int(hash & 0x7FFF_FFFF)
}
