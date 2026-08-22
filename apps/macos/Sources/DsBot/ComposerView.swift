import AppKit
import SwiftUI
import DsBotCore

/// Multi-line composer text view behind the chat input.
///
/// Owns the three behaviors SwiftUI's `TextField` cannot express: Return sends
/// while Shift+Return inserts a newline, a paste over the chip threshold never
/// enters the field (it routes to `onLargePaste` for a removable chip), and
/// the view reports its natural content height through `contentHeight` so the
/// owning layout can grow — capped by its own frame — before scrolling.
struct ComposerTextView: NSViewRepresentable {
  @Binding var text: String
  @Binding var contentHeight: CGFloat
  var onSend: () -> Void
  var onLargePaste: (String) -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(self)
  }

  func makeNSView(context: Context) -> NSScrollView {
    let scrollView = NSScrollView()
    scrollView.drawsBackground = false
    scrollView.hasVerticalScroller = true
    scrollView.autohidesScrollers = true
    scrollView.scrollerStyle = .overlay

    let textView = ComposerTextViewBacking()
    let coordinator = context.coordinator
    textView.onSend = { [weak coordinator] in coordinator?.send() }
    textView.onLargePaste = { [weak coordinator] in coordinator?.largePaste($0) }
    textView.delegate = coordinator
    textView.isRichText = false
    textView.font = .systemFont(ofSize: 15)
    textView.textColor = .labelColor
    textView.backgroundColor = .clear
    textView.drawsBackground = false
    textView.isVerticallyResizable = true
    textView.autoresizingMask = [.width]
    // Slight breathing room around the single starting line; the height sync
    // below includes these insets, so growth math stays consistent. Zeroing
    // the default 5pt line-fragment padding puts the caret and typed text on
    // the same origin the SwiftUI placeholder overlay assumes.
    textView.textContainerInset = NSSize(width: 2, height: 5)
    textView.textContainer?.lineFragmentPadding = 0
    scrollView.documentView = textView
    DispatchQueue.main.async {
      textView.window?.makeFirstResponder(textView)
      context.coordinator.syncContentHeight(from: textView)
    }
    return scrollView
  }

  func updateNSView(_ nsView: NSScrollView, context: Context) {
    context.coordinator.parent = self
    guard let textView = nsView.documentView as? ComposerTextViewBacking else { return }
    // External edits (sending clears the text) replace the content; typing
    // already matches, so the caret never jumps.
    if textView.string != text {
      textView.string = text
      context.coordinator.syncContentHeight(from: textView)
    }
  }

  /// Bridges editor events back into SwiftUI state. Holds the current
  /// representable value so callbacks read fresh closures on every render.
  final class Coordinator: NSObject, NSTextViewDelegate {
    var parent: ComposerTextView

    init(_ parent: ComposerTextView) {
      self.parent = parent
    }

    func send() {
      parent.onSend()
    }

    func largePaste(_ text: String) {
      parent.onLargePaste(text)
    }

    func textDidChange(_ notification: Notification) {
      guard let textView = notification.object as? NSTextView else { return }
      parent.text = textView.string
      syncContentHeight(from: textView)
    }

    /// Publish the laid-out content height so the owning frame can grow.
    func syncContentHeight(from textView: NSTextView) {
      guard let layoutManager = textView.layoutManager,
            let container = textView.textContainer else { return }
      layoutManager.ensureLayout(for: container)
      let used = layoutManager.usedRect(for: container).height
        + textView.textContainerInset.height * 2
      if used != parent.contentHeight {
        parent.contentHeight = used
      }
    }
  }
}

/// The concrete `NSTextView` subclass intercepting keys and pastes.
private final class ComposerTextViewBacking: NSTextView {
  var onSend: (() -> Void)?
  var onLargePaste: ((String) -> Void)?

  override func keyDown(with event: NSEvent) {
    let isReturnKey = event.keyCode == 36 || event.keyCode == 76
    if isReturnKey && !event.modifierFlags.contains(.shift) && !event.modifierFlags.contains(.option) {
      onSend?()
      return
    }
    super.keyDown(with: event)
  }

  override func paste(_ sender: Any?) {
    routePaste(sender)
  }

  /// Option+Shift+Command+V; same chip policy as the ordinary paste path.
  override func pasteAsPlainText(_ sender: Any?) {
    routePaste(sender)
  }

  private func routePaste(_ sender: Any?) {
    guard let incoming = NSPasteboard.general.string(forType: .string) else {
      super.paste(sender)
      return
    }
    if AttachmentStore.exceedsPasteChipLimit(incoming) {
      onLargePaste?(incoming)
      return
    }
    super.paste(sender)
  }
}
