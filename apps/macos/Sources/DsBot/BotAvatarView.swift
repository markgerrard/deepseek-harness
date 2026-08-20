import AppKit
import SwiftUI
import DsBotCore

struct BotAvatarView: View {
  var bot: Bot
  var size: CGFloat = 56
  var idle: Bool = false

  var body: some View {
    Group {
      if let path = bot.avatarPath, FileManager.default.fileExists(atPath: path) {
        AnimatedImageView(url: URL(fileURLWithPath: path))
          .frame(width: size, height: size)
          .clipShape(Circle())
      } else {
        BlobAvatar(seed: bot.id, size: size, idle: idle)
      }
    }
    .frame(width: size, height: size)
  }
}

struct BlobTraits {
  var fill: Color
  var squareness: CGFloat
  var hasAntenna: Bool

  init(seed: String) {
    let palette: [Color] = [
      Color(red: 1.00, green: 0.31, blue: 0.55),
      Color(red: 0.48, green: 0.32, blue: 0.98),
      Color(red: 1.00, green: 0.58, blue: 0.14),
      Color(red: 0.62, green: 0.42, blue: 0.28),
      Color(red: 0.18, green: 0.80, blue: 0.64),
      Color(red: 0.22, green: 0.78, blue: 0.38),
      Color(red: 0.95, green: 0.95, blue: 0.96),
    ]
    let hash = abs(seed.utf8.reduce(0) { $0 &+ Int($1) &* 33 })
    fill = palette[hash % palette.count]
    squareness = hash.isMultiple(of: 3) ? 0.28 : 0.50
    hasAntenna = hash % 5 == 0
  }
}

struct BlobAvatar: View {
  var seed: String
  var size: CGFloat
  var idle: Bool = false

  @State private var bob: CGFloat = 0

  private var traits: BlobTraits { BlobTraits(seed: seed) }

  var body: some View {
    let bodyWidth = size * (traits.hasAntenna ? 0.88 : 0.94)
    let bodyHeight = size * (traits.hasAntenna ? 0.78 : 0.90)
    ZStack {
      Ellipse()
        .fill(Color.black.opacity(0.28))
        .frame(width: bodyWidth * 0.92, height: size * 0.14)
        .offset(y: size * 0.40)
        .blur(radius: size * 0.04)

      if traits.hasAntenna {
        Capsule()
          .fill(traits.fill)
          .frame(width: size * 0.10, height: size * 0.22)
          .offset(y: -size * 0.38)
        Circle()
          .fill(Color.white)
          .frame(width: size * 0.16, height: size * 0.16)
          .overlay(Circle().fill(Color.black).frame(width: size * 0.07, height: size * 0.07))
          .offset(y: -size * 0.48)
      }

      RoundedRectangle(cornerRadius: size * traits.squareness, style: .continuous)
        .fill(
          RadialGradient(
            colors: [
              traits.fill.mix(with: .white, by: 0.28),
              traits.fill,
              traits.fill.mix(with: .black, by: 0.22),
            ],
            center: UnitPoint(x: 0.34, y: 0.30),
            startRadius: 0,
            endRadius: size * 0.75
          )
        )
        .frame(width: bodyWidth, height: bodyHeight)
        .offset(y: traits.hasAntenna ? size * 0.06 : 0)

      Ellipse()
        .fill(Color.white.opacity(0.38))
        .frame(width: size * 0.26, height: size * 0.14)
        .offset(
          x: -size * 0.16,
          y: (traits.hasAntenna ? size * 0.06 : 0) - size * 0.20
        )
        .blur(radius: size * 0.015)

      HStack(spacing: size * 0.06) {
        blobEye(size: size)
        blobEye(size: size)
      }
      .offset(y: (traits.hasAntenna ? size * 0.08 : 0) - size * 0.02)
    }
    .frame(width: size, height: size)
    .offset(y: bob)
    .onAppear {
      guard idle else { return }
      withAnimation(.easeInOut(duration: 1.7).repeatForever(autoreverses: true)) {
        bob = -size * 0.035
      }
    }
  }

  private func blobEye(size: CGFloat) -> some View {
    ZStack {
      Ellipse()
        .fill(Color.white)
        .frame(width: size * 0.22, height: size * 0.28)
      Circle()
        .fill(Color.black)
        .frame(width: size * 0.11, height: size * 0.13)
        .offset(y: size * 0.02)
    }
  }
}

private extension Color {
  func mix(with other: Color, by amount: CGFloat) -> Color {
    let t = max(0, min(1, amount))
    let nsSelf = NSColor(self).usingColorSpace(.sRGB) ?? NSColor(self)
    let nsOther = NSColor(other).usingColorSpace(.sRGB) ?? NSColor(other)
    return Color(
      red: nsSelf.redComponent * (1 - t) + nsOther.redComponent * t,
      green: nsSelf.greenComponent * (1 - t) + nsOther.greenComponent * t,
      blue: nsSelf.blueComponent * (1 - t) + nsOther.blueComponent * t
    )
  }
}

struct AnimatedImageView: NSViewRepresentable {
  var url: URL

  func makeNSView(context: Context) -> NSImageView {
    let view = NSImageView()
    view.imageScaling = .scaleProportionallyUpOrDown
    view.animates = true
    view.canDrawSubviewsIntoLayer = true
    view.image = NSImage(contentsOf: url)
    return view
  }

  func updateNSView(_ nsView: NSImageView, context: Context) {
    nsView.animates = true
    nsView.image = NSImage(contentsOf: url)
  }
}
