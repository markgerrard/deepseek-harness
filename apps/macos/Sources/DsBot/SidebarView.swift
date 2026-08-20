import SwiftUI
import DsBotCore

struct SidebarView: View {
  @Bindable var controller: SessionController
  @Binding var isCreateBotPresented: Bool
  @State private var searchText = ""
  @State private var isCreatingThread = false

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 8) {
        Image(systemName: "magnifyingglass")
          .foregroundStyle(.secondary)
        TextField("Search", text: $searchText)
          .textFieldStyle(.plain)
        Button {
          isCreateBotPresented = true
        } label: {
          Image(systemName: "plus")
            .font(.body.weight(.semibold))
        }
        .buttonStyle(.plain)
        .help("New bot")
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
      .background(Color.white.opacity(0.06))
      .clipShape(RoundedRectangle(cornerRadius: 10))
      .padding(.horizontal, 12)
      .padding(.top, 12)

      if !controller.bots.isEmpty {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 16) {
            ForEach(filteredBots) { bot in
              Button {
                controller.selectBot(id: bot.id)
              } label: {
                VStack(spacing: 6) {
                  BotAvatarView(bot: bot, size: 64)
                    .overlay {
                      Circle()
                        .stroke(
                          controller.selectedBotId == bot.id ? Color.white.opacity(0.85) : Color.clear,
                          lineWidth: 2
                        )
                    }
                  Text(bot.displayName)
                    .font(.caption)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .frame(width: 72)
                }
              }
              .buttonStyle(.plain)
            }
          }
          .padding(.horizontal, 16)
          .padding(.vertical, 14)
        }
      }

      Divider().opacity(0.3)

      if let bot = controller.selectedBot {
        let threads = filteredThreads(for: bot.id)
        List(threads, selection: Binding(
          get: { controller.selectedThreadId },
          set: { if let id = $0 { controller.selectThread(id: id) } }
        )) { thread in
          HStack(spacing: 10) {
            BotAvatarView(bot: bot, size: 36)
            VStack(alignment: .leading, spacing: 2) {
              HStack {
                Text(thread.title.isEmpty ? "New Thread" : thread.title)
                  .font(.body.weight(controller.selectedThreadId == thread.id ? .semibold : .regular))
                  .lineLimit(1)
                Spacer()
                Text(thread.createdAt, style: .time)
                  .font(.caption2)
                  .foregroundStyle(.secondary)
              }
              Text(bot.displayName)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
          }
          .tag(thread.id)
          .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
        }
        .listStyle(.sidebar)
        .scrollContentBackground(.hidden)
      } else {
        VStack {
          Spacer()
          Text("Create a bot to start")
            .font(.subheadline)
            .foregroundStyle(.secondary)
          Spacer()
        }
      }

      HStack {
        Button {
          guard let bot = controller.selectedBot else { return }
          Task {
            isCreatingThread = true
            _ = try? await controller.newThread(forBot: bot, initialPrompt: "")
            isCreatingThread = false
          }
        } label: {
          Label("New thread", systemImage: "square.and.pencil")
        }
        .buttonStyle(.plain)
        .disabled(controller.selectedBot == nil || isCreatingThread)
        Spacer()
      }
      .padding(12)
    }
    .background(Color.black.opacity(0.25))
  }

  private var filteredBots: [Bot] {
    let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if q.isEmpty { return controller.bots }
    return controller.bots.filter { $0.displayName.lowercased().contains(q) || $0.id.contains(q) }
  }

  private func filteredThreads(for botId: String) -> [DsBotCore.Thread] {
    let threads = controller.threads(forBot: botId)
    let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if q.isEmpty { return threads }
    return threads.filter { $0.title.lowercased().contains(q) }
  }
}
