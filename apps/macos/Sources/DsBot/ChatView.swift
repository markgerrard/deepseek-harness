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
  @State private var attachError: String?
  @State private var plusHovered = false
  @FocusState private var promptFocused: Bool

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
                  if let bot = controller.selectedBot {
                    BotAvatarView(bot: bot, size: 32, motion: .working)
                  }
                  if let label = controller.presentedChat.activityLabel {
                    Text(label)
                      .font(.callout)
                      .foregroundStyle(.secondary)
                  }
                  Spacer(minLength: 60)
                }
                .padding(.vertical, 6)
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

        HStack(spacing: 10) {
          Menu {
            Button("Attach files") {
              isPickingFiles = true
            }
            .disabled(isSending || pendingAttachments.count >= AttachmentStore.maxCount)
          } label: {
            Image(systemName: "plus")
              .font(.body.weight(.semibold))
              .foregroundStyle(plusHovered ? Color.white : Color.secondary)
              .frame(width: 26, height: 26)
              .background(
                Circle().fill(plusHovered ? Color.black.opacity(0.72) : Color.clear)
              )
          }
          .menuStyle(.borderlessButton)
          .menuIndicator(.hidden)
          .buttonStyle(.plain)
          .onHover { plusHovered = $0 }
          .disabled(isSending || pendingAttachments.count >= AttachmentStore.maxCount)
          .help("Attach")
          TextField(
            controller.selectedBot.map { "Message \($0.displayName)" } ?? "Message",
            text: $promptText,
            axis: .vertical
          )
          .textFieldStyle(.plain)
          .focused($promptFocused)
          .onSubmit { sendCurrentPrompt() }
          .onAppear { promptFocused = true }
          Button(action: sendCurrentPrompt) {
            Image(systemName: "arrow.up.circle.fill")
              .font(.system(size: 22))
              .symbolRenderingMode(.hierarchical)
          }
          .buttonStyle(.plain)
          .disabled(cannotSend)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color.white.opacity(0.08))
        .clipShape(Capsule())
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

  private var cannotSend: Bool {
    let emptyText = promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    return (emptyText && pendingAttachments.isEmpty) || isSending
  }

  private func sendCurrentPrompt() {
    let trimmed = promptText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let threadId = controller.selectedThreadId else { return }
    guard !trimmed.isEmpty || !pendingAttachments.isEmpty else { return }
    let files = pendingAttachments
    promptText = ""
    pendingAttachments = []
    attachError = nil
    isSending = true
    Task {
      do {
        _ = try await controller.sendPrompt(threadId: threadId, text: trimmed, attachments: files)
      } catch {
        // Error recorded in controller.threadErrors if key error
      }
      isSending = false
    }
  }

  @ViewBuilder
  private func transcriptItemView(_ item: TranscriptItem) -> some View {
    switch item {
    case .user(_, _, let text, let files):
      HStack {
        Spacer(minLength: 80)
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
              .foregroundStyle(.white)
              .padding(.horizontal, 14)
              .padding(.vertical, 10)
              .background(Color.white.opacity(0.14))
              .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
          }
        }
      }

    case .assistant(_, _, let text, let streaming):
      if streaming && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        EmptyView()
      } else {
        HStack(alignment: .top, spacing: 8) {
          MarkdownMessageView(source: text)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Color.white.opacity(0.10))
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
          Spacer(minLength: 60)
        }
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
