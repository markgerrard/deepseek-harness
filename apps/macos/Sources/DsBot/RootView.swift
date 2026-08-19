import SwiftUI
import DsBotCore

public struct RootView: View {
  @Bindable var controller: SessionController
  @State private var isCreateBotPresented = false
  @State private var isCreatingThread = false

  public init(controller: SessionController) {
    self.controller = controller
  }

  public var body: some View {
    HSplitView {
      // 1. Bot list pane
      VStack(spacing: 0) {
        HStack {
          Text("Bots")
            .font(.headline)
          Spacer()
          Button(action: { isCreateBotPresented = true }) {
            Image(systemName: "plus")
          }
          .buttonStyle(.plain)
        }
        .padding(10)
        .background(Color(nsColor: .windowBackgroundColor))

        Divider()

        List(controller.bots, selection: Binding(
          get: { controller.selectedBotId },
          set: { if let id = $0 { controller.selectBot(id: id) } }
        )) { bot in
          VStack(alignment: .leading, spacing: 2) {
            Text(bot.displayName)
              .font(.body)
              .fontWeight(controller.selectedBotId == bot.id ? .semibold : .regular)
            Text("\(bot.provider) • \(bot.model)")
              .font(.caption2)
              .foregroundColor(.secondary)
          }
          .tag(bot.id)
        }
        .listStyle(.sidebar)
      }
      .frame(minWidth: 160, idealWidth: 190, maxWidth: 260)

      // 2. Thread list pane
      VStack(spacing: 0) {
        HStack {
          Text("Threads")
            .font(.headline)
          Spacer()
          Button(action: {
            guard let bot = controller.selectedBot else { return }
            Task {
              isCreatingThread = true
              _ = try? await controller.newThread(forBot: bot, initialPrompt: "")
              isCreatingThread = false
            }
          }) {
            Image(systemName: "square.and.pencil")
          }
          .buttonStyle(.plain)
          .disabled(controller.selectedBot == nil || isCreatingThread)
        }
        .padding(10)
        .background(Color(nsColor: .windowBackgroundColor))

        Divider()

        if let selectedBot = controller.selectedBot {
          let threads = controller.threads(forBot: selectedBot.id)
          List(threads, selection: Binding(
            get: { controller.selectedThreadId },
            set: { if let id = $0 { controller.selectThread(id: id) } }
          )) { thread in
            VStack(alignment: .leading, spacing: 2) {
              Text(thread.title.isEmpty ? "New Thread" : thread.title)
                .font(.body)
                .fontWeight(controller.selectedThreadId == thread.id ? .semibold : .regular)
                .lineLimit(1)
              Text(thread.createdAt, style: .date)
                .font(.caption2)
                .foregroundColor(.secondary)
            }
            .tag(thread.id)
          }
          .listStyle(.sidebar)
        } else {
          VStack {
            Spacer()
            Text("Select a bot")
              .font(.subheadline)
              .foregroundColor(.secondary)
            Spacer()
          }
        }
      }
      .frame(minWidth: 180, idealWidth: 220, maxWidth: 300)

      // 3. Chat pane
      ChatView(controller: controller)
        .frame(minWidth: 350, idealWidth: 500)
    }
    .frame(minWidth: 700, minHeight: 450)
    .sheet(isPresented: $isCreateBotPresented) {
      CreateBotSheet(controller: controller, isPresented: $isCreateBotPresented)
    }
    .sheet(item: Binding(
      get: { controller.pendingApproval },
      set: { if $0 == nil { controller.dismissPendingApproval() } }
    )) { req in
      ApprovalSheet(request: req) { outcome in
        controller.respondToPendingApproval(with: outcome)
      }
    }
  }
}
