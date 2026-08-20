import SwiftUI
import DsBotCore

public struct ChatView: View {
  var controller: SessionController
  @State private var promptText = ""
  @State private var isSending = false
  @FocusState private var promptFocused: Bool

  public init(controller: SessionController) {
    self.controller = controller
  }

  public var body: some View {
    VStack(spacing: 0) {
      if let selectedThreadId = controller.selectedThreadId {
        HStack(spacing: 10) {
          if let bot = controller.selectedBot {
            BotAvatarView(bot: bot, size: 32)
            VStack(alignment: .leading, spacing: 1) {
              Text(bot.displayName)
                .font(.headline)
              Text(controller.selectedThread?.title ?? "")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
          } else {
            Text(controller.selectedThread?.title ?? "Chat")
              .font(.headline)
          }
          Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)

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
              ForEach(controller.currentTranscript) { item in
                transcriptItemView(item)
                  .id(item.id)
              }
            }
            .padding(16)
          }
          .onChange(of: controller.currentTranscript.count) { _, _ in
            if let last = controller.currentTranscript.last {
              withAnimation {
                proxy.scrollTo(last.id, anchor: .bottom)
              }
            }
          }
        }

        Divider()

        HStack(spacing: 10) {
          Image(systemName: "plus")
            .foregroundStyle(.secondary)
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
          .disabled(promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color.white.opacity(0.08))
        .clipShape(Capsule())
        .padding(.horizontal, 16)
        .padding(.vertical, 12)

      } else {
        VStack(spacing: 12) {
          Image(systemName: "bubble.left.and.bubble.right")
            .font(.system(size: 48))
            .foregroundStyle(.secondary)
          Text("No conversation selected")
            .font(.title2)
            .foregroundStyle(.secondary)
          Text("Pick a bot, then a thread in the sidebar.")
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
  }

  private func sendCurrentPrompt() {
    let trimmed = promptText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, let threadId = controller.selectedThreadId else { return }
    promptText = ""
    isSending = true
    Task {
      do {
        _ = try await controller.sendPrompt(threadId: threadId, text: trimmed)
      } catch {
        // Error recorded in controller.threadErrors if key error
      }
      isSending = false
    }
  }

  @ViewBuilder
  private func transcriptItemView(_ item: TranscriptItem) -> some View {
    switch item {
    case .user(_, _, let text):
      HStack {
        Spacer(minLength: 80)
        Text(text)
          .foregroundStyle(.white)
          .padding(.horizontal, 14)
          .padding(.vertical, 10)
          .background(Color.white.opacity(0.14))
          .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
      }

    case .assistant(_, _, let text, let streaming):
      HStack(alignment: .top, spacing: 8) {
        if let bot = controller.selectedBot {
          BotAvatarView(bot: bot, size: 28)
            .padding(.top, 4)
        }
        VStack(alignment: .leading, spacing: 6) {
          if streaming {
            ProgressView().controlSize(.mini)
          }
          MarkdownMessageView(source: text)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Color.white.opacity(0.10))
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        Spacer(minLength: 60)
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
