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
        // Chat Header
        HStack {
          VStack(alignment: .leading, spacing: 2) {
            Text(controller.selectedThread?.title ?? "Chat")
              .font(.headline)
            if let bot = controller.selectedBot {
              Text("\(bot.displayName) (\(bot.provider)/\(bot.model))")
                .font(.caption)
                .foregroundColor(.secondary)
            }
          }
          Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Color(nsColor: .windowBackgroundColor))

        Divider()

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

        // Input Bar
        HStack(alignment: .bottom, spacing: 8) {
          TextField("Type a message...", text: $promptText, axis: .vertical)
            .lineLimit(1...5)
            .textFieldStyle(.roundedBorder)
            .focused($promptFocused)
            .onSubmit {
              sendCurrentPrompt()
            }
            .onAppear { promptFocused = true }

          Button(action: sendCurrentPrompt) {
            Image(systemName: "arrow.up.circle.fill")
              .font(.system(size: 22))
          }
          .buttonStyle(.plain)
          .disabled(promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending)
        }
        .padding(12)
        .background(Color(nsColor: .windowBackgroundColor))

      } else {
        VStack(spacing: 12) {
          Image(systemName: "bubble.left.and.bubble.right")
            .font(.system(size: 48))
            .foregroundColor(.secondary)
          Text("No Thread Selected")
            .font(.title2)
            .foregroundColor(.secondary)
          Text("Select an existing thread from the sidebar or create a new one.")
            .font(.subheadline)
            .foregroundColor(.secondary)
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
        Spacer(minLength: 40)
        VStack(alignment: .trailing, spacing: 4) {
          Text(text)
            .padding(10)
            .background(Color.accentColor)
            .foregroundColor(.white)
            .cornerRadius(10)
        }
      }

    case .assistant(_, _, let text, let streaming):
      HStack {
        VStack(alignment: .leading, spacing: 4) {
          HStack {
            Text(controller.selectedBot?.displayName ?? "Assistant")
              .font(.caption)
              .fontWeight(.semibold)
              .foregroundColor(.secondary)
            if streaming {
              ProgressView()
                .controlSize(.mini)
            }
          }
          MarkdownMessageView(source: text)
            .padding(10)
            .background(Color(nsColor: .controlBackgroundColor))
            .cornerRadius(10)
        }
        Spacer(minLength: 40)
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
