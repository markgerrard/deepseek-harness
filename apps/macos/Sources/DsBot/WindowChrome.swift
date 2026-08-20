import AppKit
import SwiftUI

struct TitlebarSpace: NSViewRepresentable {
  func makeNSView(context: Context) -> NSView {
    let view = NSView()
    DispatchQueue.main.async { Self.apply(view.window) }
    return view
  }

  func updateNSView(_ nsView: NSView, context: Context) {
    Self.apply(nsView.window)
  }

  static func apply(_ window: NSWindow?) {
    guard let window else { return }
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true
    window.styleMask.insert(.fullSizeContentView)
    window.isMovableByWindowBackground = true
    window.titlebarSeparatorStyle = .none
  }
}

struct WindowDragArea: NSViewRepresentable {
  func makeNSView(context: Context) -> WindowDragView {
    WindowDragView()
  }

  func updateNSView(_ nsView: WindowDragView, context: Context) {}
}

final class WindowDragView: NSView {
  override var mouseDownCanMoveWindow: Bool { true }
  override var isOpaque: Bool { false }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}