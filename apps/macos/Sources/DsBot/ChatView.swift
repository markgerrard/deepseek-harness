import SwiftUI
import UniformTypeIdentifiers
import DsBotCore

public struct ChatView: View {
  @Bindable var controller: SessionController
  @Binding var isBotSettingsPresented: Bool
  @State private var promptText = ""
  @State private var isSending = false
  @State private var pendingAttachments: [ChatAttachment] = []
  @State private var isPickingFiles = false
  @State private var attachPopoverPresented = false
  @State private var attachError: String?
  @State private var plusHovered = false

  /// A paste too large for inline editing; rendered as a removable card and
  /// appended to the wire prompt on send.
  private struct PastedBlock: Identifiable, Equatable {
    let id = UUID()
    let text: String
  }
  @State private var pastedBlocks: [PastedBlock] = []

  /// Laid-out composer content height; the frame caps it at
  /// `composerMaxHeight`, beyond which the composer scrolls internally.
  @State private var composerHeight: CGFloat = 20
  private static let composerMaxHeight: CGFloat = 220

  public init(controller: SessionController, isBotSettingsPresented: Binding<Bool>) {
    self.controller = controller
    self._isBotSettingsPresented = isBotSettingsPresented
  }

  public var body: some View {
    VStack(spacing: 0) {
      chatTitleBar
      Rectangle()
        .fill(Color.white.opacity(0.10))
        .frame(height: 1)

      if let selectedThreadId = controller.selectedThreadId {
        // Missing Key / Thread Error Banner
        if let threadError = controller.threadErrors[selectedThreadId] {
          HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
              .foregroundColor(.yellow)
            Text(threadError)
              .font(.callout)
              .foregroundColor(.red)
            Spacer()
          }
          .padding(10)
          .background(Color.red.opacity(0.1))
          .cornerRadius(6)
          .padding(.horizontal, 16)
          .padding(.top, 8)
        }

        // Messages Transcript
        ScrollViewReader { proxy in
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
              if controller.presentedChat.hasEarlier {
                ProgressView()
                  .controlSize(.small)
                  .frame(maxWidth: .infinity)
                  .padding(.vertical, 8)
                  .id("earlier-sentinel")
                  .onAppear {
                    let anchor = controller.presentedChat.items.first?.id
                    controller.loadEarlierItems()
                    if let anchor {
                      DispatchQueue.main.async { proxy.scrollTo(anchor, anchor: .top) }
                    }
                  }
              }
              ForEach(controller.presentedChat.items) { item in
                transcriptItemView(item)
                  .id(item.id)
              }
              if showWorkingIndicator {
                HStack(alignment: .center, spacing: 10) {
                  WorkingDots(color: controller.selectedBot.map {
                    let c = $0.resolvedLook.color
                    return Color(red: c.r, green: c.g, blue: c.b)
                  } ?? .secondary)
                  if let label = controller.presentedChat.activityLabel {
                    Text(label)
                      .font(.callout)
                      .foregroundStyle(.secondary)
                  }
                  Spacer(minLength: 60)
                }
                .padding(.vertical, 6)
                .padding(.leading, 2)
                .id("waiting-for-reply")
              }
            }
            .padding(16)
          }
          .defaultScrollAnchor(.bottom)
          .onChange(of: controller.presentedChat.items.last?.id) { _, _ in
            if let last = controller.presentedChat.items.last {
              withAnimation {
                proxy.scrollTo(last.id, anchor: .bottom)
              }
            }
          }
        }

        Divider()

        if let attachError {
          Text(attachError)
            .font(.caption)
            .foregroundStyle(.red)
            .padding(.horizontal, 16)
            .padding(.top, 6)
        }

        if !pendingAttachments.isEmpty {
          ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
              ForEach(pendingAttachments) { file in
                HStack(spacing: 6) {
                  Image(systemName: "doc")
                    .font(.caption)
                  Text(file.originalName)
                    .font(.caption)
                    .lineLimit(1)
                  Button {
                    pendingAttachments.removeAll { $0.id == file.id }
                  } label: {
                    Image(systemName: "xmark.circle.fill")
                      .font(.caption)
                      .foregroundStyle(.secondary)
                  }
                  .buttonStyle(.plain)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.white.opacity(0.10))
                .clipShape(Capsule())
              }
            }
            .padding(.horizontal, 16)
          }
          .padding(.top, 8)
        }

        // Grok Bot-style composer: a single-line capsule at rest — plus in a
        // circle, text, send, all inline — that grows into a tall card with
        // the controls dropping to a bottom row once the draft wraps.
        VStack(spacing: 0) {
          if !pastedBlocks.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
              HStack(spacing: 8) {
                ForEach(pastedBlocks) { pasteCard($0) }
              }
            }
            .padding(.bottom, 8)
          }
          if isComposerExpanded {
            composerField
              .frame(maxWidth: .infinity, alignment: .leading)
            composerControls
              .padding(.top, 8)
          } else {
            HStack(spacing: 10) {
              attachButton
              composerField
                .frame(maxWidth: .infinity)
              if isBotWorking {
                stopTurnButton
              }
              sendButton
            }
          }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(
          RoundedRectangle(
            cornerRadius: isComposerExpanded ? 20 : 22,
            style: .continuous
          )
          .fill(Color.white.opacity(0.08))
        )
        .clipShape(
          RoundedRectangle(
            cornerRadius: isComposerExpanded ? 20 : 22,
            style: .continuous
          )
        )
        .animation(.easeInOut(duration: 0.15), value: isComposerExpanded)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .fileImporter(
          isPresented: $isPickingFiles,
          allowedContentTypes: [.item],
          allowsMultipleSelection: true
        ) { result in
          switch result {
          case .success(let urls):
            do {
              let incoming = try controller.ingestAttachments(from: urls)
              let room = AttachmentStore.maxCount - pendingAttachments.count
              pendingAttachments.append(contentsOf: incoming.prefix(max(0, room)))
              attachError = incoming.count > room ? AttachmentStoreError.tooMany.localizedDescription : nil
            } catch {
              attachError = error.localizedDescription
            }
          case .failure(let error):
            attachError = error.localizedDescription
          }
        }

      } else {
        VStack(spacing: 12) {
          Image(systemName: "bubble.left.and.bubble.right")
            .font(.system(size: 48))
            .foregroundStyle(.secondary)
          Text("No conversation selected")
            .font(.title2)
            .foregroundStyle(.secondary)
          Text("Pick a bot in the sidebar.")
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
  }

  private var chatTitleBar: some View {
    HStack(spacing: 8) {
      if let bot = controller.selectedBot {
        Button {
          isBotSettingsPresented.toggle()
        } label: {
          HStack(spacing: 8) {
            BotAvatarView(bot: bot, size: 22, motion: .still)
            Text(bot.displayName)
              .font(.headline)
              .foregroundStyle(.primary)
          }
        }
        .buttonStyle(.plain)
        .help("Bot settings")
      } else {
        Text("DsBot")
          .font(.headline)
          .allowsHitTesting(false)
      }
      Spacer()
    }
    .padding(.horizontal, 16)
    .frame(height: 40)
    .frame(maxWidth: .infinity)
    .background(WindowDragArea())
  }

  private var isBotWorking: Bool {
    isSending || controller.presentedChat.isWorking
  }

  private var showWorkingIndicator: Bool {
    isBotWorking
  }

  /// One line of text plus its container insets; anything taller means the
  /// draft wrapped or contains newlines, which switches the composer from the
  /// resting capsule to the tall card.
  private var isComposerExpanded: Bool {
    composerHeight > 34
  }

  /// The editable text with its placeholder overlay.
  private var composerField: some View {
    ZStack(alignment: .topLeading) {
      if promptText.isEmpty {
        Text(controller.selectedBot.map { "Message \($0.displayName)" } ?? "Message")
          .font(.system(size: 15))
          .foregroundStyle(.secondary)
          .allowsHitTesting(false)
          // Matches the text view's container insets so the placeholder sits
          // exactly where typed text starts.
          .padding(.leading, 2)
          .padding(.top, 5)
      }
      ComposerTextView(
        text: $promptText,
        contentHeight: $composerHeight,
        onSend: sendCurrentPrompt,
        onLargePaste: { pastedBlocks.append(PastedBlock(text: $0)) }
      )
      .frame(
        minHeight: 30,
        maxHeight: min(max(composerHeight, 30), Self.composerMaxHeight)
      )
    }
  }

  /// Plus-in-circle attach button; the circle has a persistent white ring and
  /// brightens on hover like the reference product. A plain Button (not
  /// `Menu`) because AppKit menu-item rendering drops label strokes, and the
  /// popover must open above the icon.
  private var attachButton: some View {
    Button {
      attachPopoverPresented = true
    } label: {
      Image(systemName: "plus")
        .font(.body.weight(.semibold))
        .foregroundStyle(plusHovered ? Color.white : Color.secondary)
        .frame(width: 26, height: 26)
        .background(
          Circle().fill(plusHovered ? Color.black.opacity(0.72) : Color.white.opacity(0.08))
        )
        .overlay(Circle().strokeBorder(Color.white.opacity(0.30), lineWidth: 1))
    }
    .buttonStyle(.plain)
    .onHover { plusHovered = $0 }
    .disabled(isSending || pendingAttachments.count >= AttachmentStore.maxCount)
    .help("Attach")
    .popover(isPresented: $attachPopoverPresented, arrowEdge: .top) {
      VStack(alignment: .leading, spacing: 2) {
        Button {
          isPickingFiles = true
          attachPopoverPresented = false
        } label: {
          Label("Attach files", systemImage: "doc")
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .disabled(isSending || pendingAttachments.count >= AttachmentStore.maxCount)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
      }
      .padding(6)
      .frame(minWidth: 150)
    }
  }

  private var stopTurnButton: some View {
    Button(action: { Task { await controller.stopCurrentTurn() } }) {
      Image(systemName: "stop.circle.fill")
        .font(.system(size: 22))
        .symbolRenderingMode(.hierarchical)
        .foregroundStyle(.red)
    }
    .buttonStyle(.plain)
    .help("Stop the current reply")
  }

  /// White circle with a black up arrow, always visible like the reference;
  /// `cannotSend` only disables clicks.
  private var sendButton: some View {
    Button(action: sendCurrentPrompt) {
      Image(systemName: "arrow.up")
        .font(.system(size: 13, weight: .bold))
        .foregroundStyle(.black)
        .frame(width: 26, height: 26)
        .background(Circle().fill(Color.white))
    }
    .buttonStyle(.plain)
    .disabled(cannotSend)
    .help("Send")
  }

  private var composerControls: some View {
    HStack(spacing: 10) {
      attachButton
      Spacer()
      if isBotWorking {
        stopTurnButton
      }
      sendButton
    }
  }

  /// claude.ai-style card for a pasted block: a small square-ish excerpt card
  /// (text preview over a PASTED badge) laid out in a horizontal grid beside
  /// its siblings; ✕ removes it.
  private func pasteCard(_ block: PastedBlock) -> some View {
    ZStack(alignment: .topTrailing) {
      VStack(alignment: .leading, spacing: 6) {
        Text(block.text)
          .font(.caption2)
          .foregroundStyle(.secondary)
          .lineLimit(5)
          .multilineTextAlignment(.leading)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        Text("Pasted")
          .font(.caption2.weight(.semibold))
          .textCase(.uppercase)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      .padding(8)
      .frame(width: 120, height: 110, alignment: .topLeading)
      .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white.opacity(0.05)))
      .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Color.white.opacity(0.12)))
      .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
      Button {
        pastedBlocks.removeAll { $0.id == block.id }
      } label: {
        Image(systemName: "xmark.circle.fill")
          .font(.system(size: 12))
          .foregroundStyle(.secondary)
      }
      .buttonStyle(.plain)
      .padding(3)
      .help("Remove pasted text")
    }
  }

  private var cannotSend: Bool {
    let emptyText = promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    return (emptyText && pendingAttachments.isEmpty && pastedBlocks.isEmpty) || isSending
  }

  private func sendCurrentPrompt() {
    guard !isSending else { return }
    let trimmed = promptText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let threadId = controller.selectedThreadId else { return }
    guard !trimmed.isEmpty || !pendingAttachments.isEmpty || !pastedBlocks.isEmpty else { return }
    let files = pendingAttachments
    let pastes = pastedBlocks.map(\.text)
    promptText = ""
    pendingAttachments = []
    pastedBlocks = []
    attachError = nil
    isSending = true
    Task {
      do {
        _ = try await controller.sendPrompt(
          threadId: threadId,
          text: trimmed,
          attachments: files,
          pastedTexts: pastes
        )
      } catch {
        // Error recorded in controller.threadErrors if key error
      }
      isSending = false
    }
  }

  @State private var hoveredItemId: String?

  /// Grok Bot-style hover actions beside a bubble: a copy button and an
  /// ellipsis menu, revealed while the pointer is over the message row. Bot
  /// bubbles carry it on their right, user bubbles on their left; it stays
  /// laid out (opacity-hidden) so revealing never reflows.
  @ViewBuilder
  private func hoverActions(text: String, itemId: String) -> some View {
    HoverActionRow(text: text, visible: hoveredItemId == itemId)
  }

  /// Track the pointer per message row to drive its hover actions.
  private func trackHover(_ itemId: String) -> some ViewModifier {
    HoverTracker(itemId: itemId, hoveredItemId: $hoveredItemId)
  }

  @ViewBuilder
  private func transcriptItemView(_ item: TranscriptItem) -> some View {
    switch item {
    case .user(_, _, let text, let files):
      HStack(alignment: .center, spacing: 8) {
        Spacer(minLength: 80)
        hoverActions(text: text, itemId: item.id)
        VStack(alignment: .trailing, spacing: 6) {
          if !files.isEmpty {
            VStack(alignment: .trailing, spacing: 4) {
              ForEach(files) { file in
                HStack(spacing: 6) {
                  Image(systemName: "doc.fill")
                    .font(.caption)
                  Text(file.originalName)
                    .font(.caption)
                    .lineLimit(1)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.white.opacity(0.10))
                .clipShape(Capsule())
              }
            }
          }
          if !text.isEmpty {
            Text(text)
              .font(.system(size: 15))
              .foregroundStyle(.white)
              .padding(.horizontal, 14)
              .padding(.vertical, 10)
              .background(Color.white.opacity(0.14))
              .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
          }
        }
      }
      .modifier(trackHover(item.id))

    case .assistant(_, _, let text, let streaming):
      if streaming && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        EmptyView()
      } else {
        HStack(alignment: .center, spacing: 8) {
          Group {
            if streaming {
              StreamingMarkdownView(text: text)
            } else {
              MarkdownMessageView(source: text)
                .equatable()
            }
          }
          .padding(.horizontal, 14)
          .padding(.vertical, 10)
          .background(Color.white.opacity(0.10))
          .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
          if !streaming {
            hoverActions(text: text, itemId: item.id)
          }
          Spacer(minLength: 60)
        }
        .modifier(trackHover(item.id))
      }

    case .reasoning(let id, _, let text, let streaming, let expanded):
      VStack(alignment: .leading, spacing: 4) {
        Button(action: {
          controller.toggleExpansion(id: id, kind: "reasoning")
        }) {
          HStack(spacing: 4) {
            Image(systemName: expanded ? "chevron.down" : "chevron.right")
              .font(.caption2)
            Text("Thinking")
              .font(.caption)
              .fontWeight(.medium)
            if streaming {
              ProgressView()
                .controlSize(.mini)
            }
          }
          .foregroundColor(.secondary)
        }
        .buttonStyle(.plain)

        if expanded {
          Text(text)
            .font(.callout)
            .foregroundColor(.secondary)
            .padding(8)
            .background(Color(nsColor: .windowBackgroundColor).opacity(0.6))
            .cornerRadius(6)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.2)))
        }
      }

    case .tool(let id, _, _, let name, let args, let result, let status, let expanded, _):
      VStack(alignment: .leading, spacing: 4) {
        Button(action: {
          controller.toggleExpansion(id: id, kind: "tool")
        }) {
          HStack(spacing: 6) {
            Image(systemName: expanded ? "chevron.down" : "chevron.right")
              .font(.caption2)
            Image(systemName: "wrench.and.screwdriver.fill")
              .font(.caption)
            Text(name)
              .font(.caption)
              .fontWeight(.semibold)
            Spacer()
            toolStatusBadge(status)
          }
          .padding(6)
          .background(Color(nsColor: .controlBackgroundColor))
          .cornerRadius(6)
        }
        .buttonStyle(.plain)

        if expanded {
          VStack(alignment: .leading, spacing: 6) {
            if !args.isEmpty {
              Text("Arguments:")
                .font(.caption2)
                .foregroundColor(.secondary)
              Text(args)
                .font(.system(.caption, design: .monospaced))
                .padding(6)
                .background(Color(nsColor: .textBackgroundColor))
                .cornerRadius(4)
            }
            if let result = result, !result.isEmpty {
              Text("Result:")
                .font(.caption2)
                .foregroundColor(.secondary)
              Text(result)
                .font(.system(.caption, design: .monospaced))
                .padding(6)
                .background(Color(nsColor: .textBackgroundColor))
                .cornerRadius(4)
            }
          }
          .padding(.leading, 12)
        }
      }

    case .artifact(_, _, let name, let path):
      HStack(alignment: .top, spacing: 8) {
        HStack(spacing: 8) {
          Image(systemName: "doc.fill")
            .font(.caption)
          VStack(alignment: .leading, spacing: 2) {
            Text(name)
              .font(.caption)
              .fontWeight(.medium)
            Text(path)
              .font(.caption2)
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.white.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        Spacer(minLength: 60)
      }

    case .command(_, _, let text):
      HStack {
        Text("$ \(text)")
          .font(.system(.caption, design: .monospaced))
          .foregroundColor(.secondary)
          .padding(6)
          .background(Color(nsColor: .controlBackgroundColor))
          .cornerRadius(4)
        Spacer()
      }

    case .workflow(let id, _, _, let name, let status, let members, let expanded):
      VStack(alignment: .leading, spacing: 4) {
        Button(action: {
          controller.toggleExpansion(id: id, kind: "workflow")
        }) {
          HStack(spacing: 6) {
            Image(systemName: expanded ? "chevron.down" : "chevron.right")
              .font(.caption2)
            Image(systemName: "arrow.triangle.branch")
              .font(.caption)
            Text("Workflow: \(name)")
              .font(.caption)
              .fontWeight(.semibold)
            Spacer()
            workflowStatusBadge(status)
          }
          .padding(6)
          .background(Color(nsColor: .controlBackgroundColor))
          .cornerRadius(6)
        }
        .buttonStyle(.plain)

        if expanded {
          VStack(alignment: .leading, spacing: 4) {
            ForEach(members, id: \.seq) { member in
              HStack {
                Text(member.label)
                  .font(.caption)
                if let phase = member.phase {
                  Text("(\(phase))")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                }
                Spacer()
                workflowStatusBadge(member.status)
              }
              .padding(.horizontal, 8)
            }
          }
          .padding(.leading, 12)
        }
      }
    }
  }

  @ViewBuilder
  private func toolStatusBadge(_ status: ToolCardStatus) -> some View {
    switch status {
    case .running:
      HStack(spacing: 4) {
        ProgressView().controlSize(.mini)
        Text("running").font(.caption2)
      }
      .foregroundColor(.blue)
    case .success:
      Label("success", systemImage: "checkmark.circle.fill")
        .font(.caption2)
        .foregroundColor(.green)
    case .error:
      Label("error", systemImage: "xmark.circle.fill")
        .font(.caption2)
        .foregroundColor(.red)
    case .awaiting:
      Label("awaiting", systemImage: "clock.fill")
        .font(.caption2)
        .foregroundColor(.orange)
    }
  }

  @ViewBuilder
  private func workflowStatusBadge(_ status: WorkflowStatus) -> some View {
    switch status {
    case .running:
      HStack(spacing: 4) {
        ProgressView().controlSize(.mini)
        Text("running").font(.caption2)
      }
      .foregroundColor(.blue)
    case .success:
      Label("done", systemImage: "checkmark.circle.fill")
        .font(.caption2)
        .foregroundColor(.green)
    case .error:
      Label("error", systemImage: "xmark.circle.fill")
        .font(.caption2)
        .foregroundColor(.red)
    }
  }
}

/// Applies onHover to a message row, claiming and releasing the shared
/// hovered-item id.
private struct HoverTracker: ViewModifier {
  let itemId: String
  @Binding var hoveredItemId: String?

  func body(content: Content) -> some View {
    // The row's spacers and inter-view gaps are not hit-testable by default,
    // so moving the pointer from a bubble toward its actions would drop the
    // hover before reaching them.
    content.contentShape(Rectangle()).onHover { inside in
      if inside {
        hoveredItemId = itemId
      } else if hoveredItemId == itemId {
        hoveredItemId = nil
      }
    }
  }
}

/// Copy + ellipsis controls revealed by the owning row's hover tracking.
/// Opacity-hidden when idle so appearing never shifts layout.
private struct HoverActionRow: View {
  let text: String
  let visible: Bool
  @State private var copied = false
  @State private var menuPresented = false

  var body: some View {
    HStack(spacing: 6) {
      Button {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        copied = true
        Task { @MainActor in
          try? await Task.sleep(for: .seconds(1))
          copied = false
        }
      } label: {
        Image(systemName: copied ? "checkmark" : "doc.on.doc")
          .font(.system(size: 12))
          .foregroundStyle(.secondary)
      }
      .buttonStyle(.plain)
      .help("Copy")
      Button {
        menuPresented = true
      } label: {
        Image(systemName: "ellipsis")
          .font(.system(size: 12))
          .foregroundStyle(.secondary)
      }
      .buttonStyle(.plain)
      .help("More")
      .popover(isPresented: $menuPresented, arrowEdge: .bottom) {
        VStack(alignment: .leading, spacing: 2) {
          Button {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
            menuPresented = false
          } label: {
            Label("Copy", systemImage: "doc.on.doc")
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          .buttonStyle(.plain)
          .padding(.horizontal, 10)
          .padding(.vertical, 6)
        }
        .padding(6)
        .frame(minWidth: 140)
      }
    }
    // The popover takes the pointer out of the row, so hover alone would hide
    // the control that opened it: an open popover keeps the row visible.
    .opacity(visible || menuPresented ? 1 : 0)
    .accessibilityHidden(!(visible || menuPresented))
  }
}

/// Streaming assistant text rendered the way Grok Bot does: paragraphs that
/// can no longer change are laid out once as markdown and skipped on later
/// chunks (`.equatable()` on unchanged settled text), while only the
/// in-progress trailing paragraph re-renders as plain text. One chunk
/// therefore costs a short paragraph's layout, not the whole bubble's.
private struct StreamingMarkdownView: View {
  let text: String

  var body: some View {
    let split = splitSettledTail(text)
    // Each settled paragraph is its own equatable subview keyed by position,
    // so a completing paragraph appends one view instead of rebuilding every
    // earlier paragraph's attributed text.
    let settledParagraphs = split.settled.isEmpty
      ? []
      : split.settled.components(separatedBy: "\n\n").filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    VStack(alignment: .leading, spacing: 10) {
      ForEach(Array(settledParagraphs.enumerated()), id: \.offset) { _, paragraph in
        MarkdownMessageView(source: paragraph)
          .equatable()
      }
      if !split.tail.isEmpty {
        Text(split.tail)
          .font(.system(size: 15))
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }
}

/// The three pulsing dots shown beneath a bot's bubble for the whole turn —
/// before the first chunk, between chunks, and through tool work — matching
/// the reference product's working indicator.
private struct WorkingDots: View {
  let color: Color
  @State private var phase = 0.0

  var body: some View {
    HStack(spacing: 4) {
      ForEach(0..<3, id: \.self) { index in
        Circle()
          .fill(color)
          .frame(width: 6, height: 6)
          .opacity(opacity(for: index))
      }
    }
    .onAppear {
      withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: false)) {
        phase = 3
      }
    }
    .accessibilityLabel("Working")
  }

  /// Ripple the dots by staggering each one a third of a cycle behind the last.
  private func opacity(for index: Int) -> Double {
    let position = (phase - Double(index)).truncatingRemainder(dividingBy: 3)
    let distance = min(abs(position), 3 - abs(position))
    return 0.35 + 0.65 * max(0, 1 - distance)
  }
}
