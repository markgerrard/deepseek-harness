import SwiftUI
import DsBotCore

struct SidebarView: View {
  @Bindable var controller: SessionController
  @Binding var isCreateBotPresented: Bool
  @Binding var editingBot: Bot?
  @Binding var isAccountSettingsPresented: Bool
  @State private var searchText = ""
  @State private var accountHovered = false

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

      if !filteredPinned.isEmpty {
        LazyVGrid(
          columns: [GridItem(.adaptive(minimum: 72, maximum: 88), spacing: 18, alignment: .top)],
          alignment: .leading,
          spacing: 16
        ) {
          ForEach(filteredPinned) { bot in
            pinnedBotCell(bot)
          }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 16)

        Divider().opacity(0.3)
      }

      if controller.bots.isEmpty {
        VStack {
          Spacer()
          Text("Create a bot to start")
            .font(.subheadline)
            .foregroundStyle(.secondary)
          Spacer()
        }
      } else if filteredPinned.isEmpty && filteredUnpinned.isEmpty {
        VStack {
          Spacer()
          Text("No bots match")
            .font(.subheadline)
            .foregroundStyle(.secondary)
          Spacer()
        }
      } else if !filteredUnpinned.isEmpty {
        List(filteredUnpinned, selection: Binding(
          get: { controller.selectedBotId },
          set: { if let id = $0 { controller.selectBot(id: id) } }
        )) { bot in
          unpinnedBotRow(bot)
            .tag(bot.id)
            .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
            .contextMenu { pinMenuItems(for: bot) }
        }
        .listStyle(.sidebar)
        .scrollContentBackground(.hidden)
      } else {
        Spacer()
      }

      accountBar
    }
    .background(Color.black.opacity(0.25))
  }

  private var accountBar: some View {
    HStack {
      Menu {
        Button("Settings…") {
          isAccountSettingsPresented = true
        }
      } label: {
        BlobAvatar(seed: NSUserName(), size: 34, idle: accountHovered)
          .opacity(accountHovered ? 1 : 0.92)
      }
      .menuStyle(.borderlessButton)
      .menuIndicator(.hidden)
      .buttonStyle(.plain)
      .onHover { accountHovered = $0 }
      .help("Account")
      .contextMenu {
        Button("Settings…") {
          isAccountSettingsPresented = true
        }
      }
      Spacer()
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 10)
  }

  private var query: String {
    searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  }

  private func matchesSearch(_ bot: Bot) -> Bool {
    if query.isEmpty { return true }
    return bot.displayName.lowercased().contains(query) || bot.id.contains(query)
  }

  private var filteredPinned: [Bot] {
    controller.pinnedBots.filter(matchesSearch)
  }

  private var filteredUnpinned: [Bot] {
    controller.unpinnedBots.filter(matchesSearch)
  }

  @ViewBuilder
  private func pinnedBotCell(_ bot: Bot) -> some View {
    let selected = controller.selectedBotId == bot.id
    VStack(spacing: 8) {
      ZStack(alignment: .topTrailing) {
        Button {
          controller.selectBot(id: bot.id)
        } label: {
          BotAvatarView(bot: bot, size: 68, idle: selected)
            .opacity(selected ? 1 : 0.88)
        }
        .buttonStyle(.plain)
        .contextMenu { pinMenuItems(for: bot) }
        Button {
          try? controller.unpinBot(id: bot.id)
        } label: {
          Image(systemName: "pin.fill")
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(.white)
            .padding(5)
            .background(Circle().fill(Color.black.opacity(0.55)))
        }
        .buttonStyle(.plain)
        .help("Unpin")
        .offset(x: 6, y: -4)
      }
      Text(bot.displayName)
        .font(.caption)
        .foregroundStyle(.primary)
        .lineLimit(1)
        .frame(maxWidth: 80)
    }
    .contextMenu { pinMenuItems(for: bot) }
  }

  @ViewBuilder
  private func unpinnedBotRow(_ bot: Bot) -> some View {
    let selected = controller.selectedBotId == bot.id
    HStack(spacing: 10) {
      BotAvatarView(bot: bot, size: 36, idle: selected)
      VStack(alignment: .leading, spacing: 2) {
        Text(bot.displayName)
          .font(.body.weight(selected ? .semibold : .regular))
          .lineLimit(1)
        if let preview = controller.lastMessagePreview(forBot: bot.id) {
          Text(preview)
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
      Spacer(minLength: 8)
      Button {
        try? controller.pinBot(id: bot.id)
      } label: {
        Image(systemName: "pin")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      .buttonStyle(.plain)
      .help("Pin")
    }
    .contentShape(Rectangle())
    .contextMenu { pinMenuItems(for: bot) }
  }

  @ViewBuilder
  private func pinMenuItems(for bot: Bot) -> some View {
    if bot.pinned {
      Button("Unpin") {
        try? controller.unpinBot(id: bot.id)
      }
    } else {
      Button("Pin") {
        try? controller.pinBot(id: bot.id)
      }
    }
    Button("Settings…") {
      controller.selectBot(id: bot.id)
      editingBot = bot
    }
    Divider()
    Button("Delete Bot", role: .destructive) {
      try? controller.deleteBot(id: bot.id)
    }
  }
}
