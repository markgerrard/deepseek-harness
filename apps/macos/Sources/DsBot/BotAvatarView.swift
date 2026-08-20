import AppKit
import SwiftUI
import DsBotCore

struct BotAvatarView: View {
  var bot: Bot
  var size: CGFloat = 56
  var motion: BlobMotion = .idle

  var body: some View {
    let look = bot.resolvedLook
    Group {
      if let path = bot.avatarPath, FileManager.default.fileExists(atPath: path) {
        AnimatedImageView(url: URL(fileURLWithPath: path))
          .frame(width: size, height: size)
          .clipShape(BlobSilhouette(shape: look.shape))
      } else {
        BlobAvatar(seed: bot.id, size: size, look: look, motion: motion)
      }
    }
    .frame(width: size, height: size)
  }
}

struct BlobAvatar: View {
  var seed: String
  var size: CGFloat
  var look: BlobLook?
  var motion: BlobMotion = .idle

  private var resolved: BlobLook {
    look ?? BlobLook.derived(from: seed)
  }

  var body: some View {
    let phase = Double((abs(seed.hashValue) % 628)) / 100.0
    if motion == .still {
      posed(blobPose(motion: .still, time: 0, phase: 0))
    } else {
      TimelineView(.animation(minimumInterval: 1 / 24, paused: false)) { context in
        let t = context.date.timeIntervalSinceReferenceDate
        posed(blobPose(motion: motion, time: t, phase: phase))
      }
    }
  }

  private func posed(_ pose: BlobPose) -> some View {
    ZStack {
      Ellipse()
        .fill(Color.black.opacity(0.26))
        .frame(width: size * 0.72, height: size * 0.12)
        .offset(y: size * 0.40)
        .blur(radius: size * 0.035)
        .scaleEffect(x: pose.scaleX, y: 1)

      blobBody(look: resolved, size: size)
        .overlay {
          blobEyes(size: size, blink: pose.blink, shape: resolved.shape)
        }
        .scaleEffect(x: pose.scaleX, y: pose.scaleY)
        .rotationEffect(.radians(pose.tilt))
        .offset(y: pose.bounceY * size)
    }
    .frame(width: size, height: size)
  }

  @ViewBuilder
  private func blobBody(look: BlobLook, size: CGFloat) -> some View {
    let fill = Color(
      red: look.color.r,
      green: look.color.g,
      blue: look.color.b
    )
    let highlight = fill.mix(with: .white, by: 0.28)
    let shade = fill.mix(with: .black, by: 0.18)
    let gradient = RadialGradient(
      colors: [highlight, fill, shade],
      center: UnitPoint(x: 0.34, y: 0.28),
      startRadius: 0,
      endRadius: size * 0.78
    )

    if look.shape == .cube {
      BlobCube(fill: fill, highlight: highlight, shade: shade, size: size)
    } else if look.shape == .cloud {
      BlobCloud(fill: gradient, size: size)
    } else {
      BlobSilhouette(shape: look.shape)
        .fill(gradient)
        .frame(width: size, height: size)
        .overlay {
          BlobSilhouette(shape: look.shape)
            .fill(Color.white.opacity(0.28))
            .frame(width: size * 0.28, height: size * 0.16)
            .offset(x: -size * 0.14, y: -size * 0.18)
            .blur(radius: size * 0.02)
            .mask(BlobSilhouette(shape: look.shape))
        }
    }
  }

  private func blobEyes(size: CGFloat, blink: CGFloat, shape: BlobShape) -> some View {
    let offset: CGSize = {
      switch shape {
      case .triangle, .drop: return CGSize(width: 0, height: size * 0.10)
      case .cloud: return CGSize(width: 0, height: size * 0.04)
      case .cube: return CGSize(width: 0, height: size * 0.06)
      case .whale: return CGSize(width: -size * 0.16, height: size * 0.06)
      default: return .zero
      }
    }()
    return HStack(spacing: size * (shape == .whale ? 0.05 : 0.07)) {
      eye(size: size * (shape == .whale ? 0.86 : 1), blink: blink)
      eye(size: size * (shape == .whale ? 0.86 : 1), blink: blink)
    }
    .offset(x: offset.width, y: offset.height)
  }

  private func eye(size: CGFloat, blink: CGFloat) -> some View {
    ZStack {
      Ellipse()
        .fill(Color.white)
        .frame(width: size * 0.18, height: size * 0.24 * blink)
      Ellipse()
        .fill(Color.black)
        .frame(width: size * 0.08, height: size * 0.11 * blink)
        .offset(y: size * 0.02 * blink)
    }
  }
}

struct BlobSilhouette: Shape {
  var shape: BlobShape

  func path(in rect: CGRect) -> Path {
    switch shape {
    case .circle:
      return Path(ellipseIn: rect.insetBy(dx: rect.width * 0.08, dy: rect.height * 0.08))
    case .oval:
      return Path(ellipseIn: rect.insetBy(dx: rect.width * 0.04, dy: rect.height * 0.16))
    case .squircle:
      return Path(
        roundedRect: rect.insetBy(dx: rect.width * 0.10, dy: rect.height * 0.10),
        cornerRadius: min(rect.width, rect.height) * 0.22
      )
    case .pill:
      let inset = rect.insetBy(dx: rect.width * 0.02, dy: rect.height * 0.22)
      return Path(roundedRect: inset, cornerRadius: inset.height / 2)
    case .triangle:
      return roundedTriangle(in: rect.insetBy(dx: rect.width * 0.08, dy: rect.height * 0.08))
    case .cube:
      return Path(
        roundedRect: rect.insetBy(dx: rect.width * 0.14, dy: rect.height * 0.14),
        cornerRadius: min(rect.width, rect.height) * 0.16
      )
    case .cloud:
      return cloudPath(in: rect)
    case .drop:
      return dropPath(in: rect.insetBy(dx: rect.width * 0.10, dy: rect.height * 0.04))
    case .whale:
      return whalePath(in: rect)
    }
  }

  private func roundedTriangle(in rect: CGRect) -> Path {
    let top = CGPoint(x: rect.midX, y: rect.minY)
    let left = CGPoint(x: rect.minX, y: rect.maxY)
    let right = CGPoint(x: rect.maxX, y: rect.maxY)
    var path = Path()
    path.move(to: CGPoint(x: top.x, y: top.y + rect.height * 0.18))
    path.addQuadCurve(to: CGPoint(x: right.x - rect.width * 0.12, y: right.y - rect.height * 0.08), control: CGPoint(x: rect.maxX * 0.72, y: rect.minY + rect.height * 0.22))
    path.addQuadCurve(to: CGPoint(x: left.x + rect.width * 0.12, y: left.y - rect.height * 0.08), control: CGPoint(x: rect.midX, y: rect.maxY + rect.height * 0.08))
    path.addQuadCurve(to: CGPoint(x: top.x, y: top.y + rect.height * 0.18), control: CGPoint(x: rect.minX * 0.4 + rect.width * 0.12, y: rect.minY + rect.height * 0.22))
    path.closeSubpath()
    return path
  }

  private func dropPath(in rect: CGRect) -> Path {
    var path = Path()
    let tip = CGPoint(x: rect.midX, y: rect.minY)
    let radius = min(rect.width, rect.height) * 0.38
    let center = CGPoint(x: rect.midX, y: rect.maxY - radius)
    path.move(to: tip)
    path.addQuadCurve(
      to: CGPoint(x: center.x + radius, y: center.y),
      control: CGPoint(x: rect.maxX, y: rect.minY + rect.height * 0.28)
    )
    path.addArc(
      center: center,
      radius: radius,
      startAngle: .degrees(0),
      endAngle: .degrees(180),
      clockwise: false
    )
    path.addQuadCurve(
      to: tip,
      control: CGPoint(x: rect.minX, y: rect.minY + rect.height * 0.28)
    )
    path.closeSubpath()
    return path
  }

  private func whalePath(in rect: CGRect) -> Path {
    let w = rect.width
    let h = rect.height
    var path = Path()
    path.addEllipse(in: CGRect(
      x: rect.minX + w * 0.02,
      y: rect.minY + h * 0.30,
      width: w * 0.66,
      height: h * 0.50
    ))
    var fin = Path()
    fin.move(to: CGPoint(x: rect.minX + w * 0.34, y: rect.minY + h * 0.34))
    fin.addQuadCurve(
      to: CGPoint(x: rect.minX + w * 0.50, y: rect.minY + h * 0.34),
      control: CGPoint(x: rect.minX + w * 0.43, y: rect.minY + h * 0.08)
    )
    fin.closeSubpath()
    path.addPath(fin)
    var tail = Path()
    let joint = CGPoint(x: rect.minX + w * 0.64, y: rect.minY + h * 0.54)
    tail.move(to: joint)
    tail.addQuadCurve(
      to: CGPoint(x: rect.minX + w * 0.98, y: rect.minY + h * 0.20),
      control: CGPoint(x: rect.minX + w * 0.80, y: rect.minY + h * 0.28)
    )
    tail.addQuadCurve(
      to: CGPoint(x: rect.minX + w * 0.72, y: rect.minY + h * 0.52),
      control: CGPoint(x: rect.minX + w * 0.90, y: rect.minY + h * 0.40)
    )
    tail.addQuadCurve(
      to: CGPoint(x: rect.minX + w * 0.98, y: rect.minY + h * 0.86),
      control: CGPoint(x: rect.minX + w * 0.82, y: rect.minY + h * 0.74)
    )
    tail.addQuadCurve(
      to: joint,
      control: CGPoint(x: rect.minX + w * 0.80, y: rect.minY + h * 0.64)
    )
    tail.closeSubpath()
    path.addPath(tail)
    return path
  }

  private func cloudPath(in rect: CGRect) -> Path {
    let w = rect.width
    let h = rect.height
    var path = Path()
    path.addEllipse(in: CGRect(x: rect.minX + w * 0.08, y: rect.minY + h * 0.34, width: w * 0.46, height: h * 0.46))
    path.addEllipse(in: CGRect(x: rect.minX + w * 0.42, y: rect.minY + h * 0.34, width: w * 0.50, height: h * 0.48))
    path.addEllipse(in: CGRect(x: rect.minX + w * 0.28, y: rect.minY + h * 0.12, width: w * 0.44, height: h * 0.44))
    path.addEllipse(in: CGRect(x: rect.minX + w * 0.18, y: rect.minY + h * 0.42, width: w * 0.64, height: h * 0.40))
    return path
  }
}

private struct BlobCube: View {
  var fill: Color
  var highlight: Color
  var shade: Color
  var size: CGFloat

  var body: some View {
    ZStack {
      cubeSide
        .fill(shade)
      cubeTop
        .fill(highlight)
      RoundedRectangle(cornerRadius: size * 0.14, style: .continuous)
        .fill(fill)
        .frame(width: size * 0.62, height: size * 0.62)
        .offset(x: -size * 0.04, y: size * 0.06)
    }
    .frame(width: size, height: size)
  }

  private var cubeTop: Path {
    var path = Path()
    let s = size
    path.move(to: CGPoint(x: s * 0.16, y: s * 0.30))
    path.addLine(to: CGPoint(x: s * 0.42, y: s * 0.14))
    path.addLine(to: CGPoint(x: s * 0.84, y: s * 0.20))
    path.addLine(to: CGPoint(x: s * 0.58, y: s * 0.37))
    path.closeSubpath()
    return path
  }

  private var cubeSide: Path {
    var path = Path()
    let s = size
    path.move(to: CGPoint(x: s * 0.58, y: s * 0.37))
    path.addLine(to: CGPoint(x: s * 0.84, y: s * 0.20))
    path.addLine(to: CGPoint(x: s * 0.84, y: s * 0.68))
    path.addLine(to: CGPoint(x: s * 0.58, y: s * 0.84))
    path.closeSubpath()
    return path
  }
}

private struct BlobCloud: View {
  var fill: RadialGradient
  var size: CGFloat

  var body: some View {
    BlobSilhouette(shape: .cloud)
      .fill(fill)
      .frame(width: size, height: size)
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
