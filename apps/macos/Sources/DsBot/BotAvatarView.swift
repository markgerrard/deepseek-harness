import AppKit
import SwiftUI
import DsBotCore

struct BotAvatarView: View {
  var bot: Bot
  var size: CGFloat = 56

  private static let bundled = ["blob-pink", "blob-purple", "blob-orange"]

  var body: some View {
    avatarImage
      .frame(width: size, height: size)
      .clipShape(Circle())
  }

  @ViewBuilder
  private var avatarImage: some View {
    if let path = bot.avatarPath, FileManager.default.fileExists(atPath: path) {
      AnimatedImageView(url: URL(fileURLWithPath: path))
    } else if let url = Self.bundledAvatarURL(for: bot.id) {
      AnimatedImageView(url: url)
    } else {
      BlobAvatar(seed: bot.id, size: size)
    }
  }

  static func bundledAvatarURL(for botId: String) -> URL? {
    let idx = abs(botId.utf8.reduce(0) { $0 &+ Int($1) }) % bundled.count
    let name = bundled[idx]
    return Bundle.module.url(forResource: name, withExtension: "jpg", subdirectory: "avatars")
      ?? Bundle.module.url(forResource: name, withExtension: "jpg")
  }
}

struct BlobAvatar: View {
  var seed: String
  var size: CGFloat

  private var fill: Color {
    let palette: [Color] = [
      Color(red: 1.00, green: 0.32, blue: 0.55),
      Color(red: 0.45, green: 0.28, blue: 0.98),
      Color(red: 1.00, green: 0.55, blue: 0.12),
      Color(red: 0.55, green: 0.38, blue: 0.28),
      Color(red: 0.20, green: 0.78, blue: 0.62),
      Color(red: 0.25, green: 0.72, blue: 0.38),
    ]
    let idx = abs(seed.utf8.reduce(0) { $0 &+ Int($1) }) % palette.count
    return palette[idx]
  }

  var body: some View {
    ZStack {
      Circle().fill(fill)
      HStack(spacing: size * 0.12) {
        Capsule().fill(Color.black).frame(width: size * 0.12, height: size * 0.22)
        Capsule().fill(Color.black).frame(width: size * 0.12, height: size * 0.22)
      }
      .offset(y: -size * 0.04)
    }
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
