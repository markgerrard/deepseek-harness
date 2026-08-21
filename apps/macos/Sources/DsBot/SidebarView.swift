import SwiftUI
import DsBotCore

struct SidebarView: View {
  @Bindable var controller: SessionController
  @Binding var isCreateBotPresented: Bool
  @Binding var isBotSettingsPresented: Bool
  @Binding var isAccountSettingsPresented: Bool
  @State private var searchText = ""

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Spacer()
        Button {
          isCreateBotPresented = true
        } label: {
          Image(systemName: "plus")
            .font(.body.weight(.semibold))
            .foregroundStyle(.secondary)
        }
        .buttonStyle(.plain)
        .help("New bot")
      }
      .padding(.horizontal, 14)
      .frame(height: 40)
      .background(WindowDragArea())

      HStack(spacing: 8) {
        Image(systemName: "magnifyingglass")
          .foregroundStyle(.secondary)
        TextField("Search", text: $searchText)
          .textFieldStyle(.plain)
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
      .background(Color.white.opacity(0.07))
      .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
      .padding(.horizontal, 12)
      .padding(.bottom, 8)

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
      } else {
        ScrollView {
          VStack(alignment: .leading, spacing: 0) {
            if !filteredPinned.isEmpty {
              LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 72, maximum: 92), spacing: 18, alignment: .top)],
                alignment: .leading,
                spacing: 14
              ) {
                ForEach(filteredPinned) { bot in
                  pinnedBotCell(bot)
                }
              }
              .padding(.horizontal, 16)
              .padding(.vertical, 14)
            }

            ForEach(filteredUnpinned) { bot in
              unpinnedBotRow(bot)
                .contentShape(Rectangle())
                .onTapGesture { controller.selectBot(id: bot.id) }
                .contextMenu { pinMenuItems(for: bot) }
            }
          }
        }
      }

      VStack(spacing: 0) {
        Button {
        } label: {
          HStack(spacing: 10) {
            Image(systemName: "puzzlepiece.extension")
              .font(.body)
              .foregroundStyle(.secondary)
              .frame(width: 28, height: 28)
              .background(Circle().fill(Color.white.opacity(0.08)))
            Text("Plugins")
              .foregroundStyle(.primary)
            Spacer()
          }
          .padding(.horizontal, 14)
          .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
        .help("Plugins")

        accountBar
      }
    }
    .background(Color.black.opacity(0.22))
  }

  private var accountBar: some View {
    HStack(spacing: 10) {
      Menu {
        Button("Settings…") {
          isAccountSettingsPresented = true
        }
      } label: {
        HStack(spacing: 10) {
          BlobAvatar(seed: NSUserName(), size: 28, motion: .still)
          Text(NSFullUserName())
            .foregroundStyle(.primary)
            .lineLimit(1)
        }
      }
      .menuStyle(.borderlessButton)
      .menuIndicator(.hidden)
      .buttonStyle(.plain)
      .help("Account")
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
    Button {
      controller.selectBot(id: bot.id)
    } label: {
      VStack(spacing: 8) {
        BotAvatarView(bot: bot, size: 68, motion: .still)
          .opacity(selected ? 1 : 0.9)
        Text(bot.displayName)
          .font(.caption)
          .foregroundStyle(.primary)
          .lineLimit(1)
          .frame(maxWidth: 80)
      }
    }
    .buttonStyle(.plain)
    .contextMenu { pinMenuItems(for: bot) }
  }

  @ViewBuilder
  private func unpinnedBotRow(_ bot: Bot) -> some View {
    let selected = controller.selectedBotId == bot.id
    HStack(spacing: 10) {
      BotAvatarView(bot: bot, size: 36, motion: .still)
      VStack(alignment: .leading, spacing: 3) {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(bot.displayName)
            .font(.body.weight(selected ? .semibold : .regular))
            .lineLimit(1)
          Spacer(minLength: 8)
          if let stamp = controller.activityStamp(forBot: bot.id) {
            Text(stamp)
              .font(.body)
              .foregroundStyle(.secondary)
              .fixedSize()
          }
        }
        if let preview = controller.lastMessagePreview(forBot: bot.id) {
          Text(preview)
            .font(.system(size: 15))
            .foregroundStyle(.secondary)
            .lineLimit(2)
            .truncationMode(.tail)
        }
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .background(selected ? Color.white.opacity(0.06) : Color.clear)
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
      isBotSettingsPresented = true
    }
    Divider()
    Button("Delete Bot", role: .destructive) {
      try? controller.deleteBot(id: bot.id)
    }
  }
}
