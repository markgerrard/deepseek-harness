import SwiftUI
import UniformTypeIdentifiers
import DsBotCore

struct BotSettingsInspector: View {
  @Bindable var controller: SessionController
  var botId: String
  var onClose: () -> Void

  @State private var displayName = ""
  @State private var title = ""
  @State private var job = ""
  @State private var provider = LlmCatalog.defaultProviderId
  @State private var model = LlmCatalog.defaultModelId(for: LlmCatalog.defaultProviderId)
  @State private var thinking = "off"
  @State private var chatSurfaceTag = "inherit"
  @State private var isSaving = false
  @State private var errorMessage: String?
  @State private var isPickingAvatar = false
  @State private var isAvatarPickerPresented = false
  @State private var pane: SettingsPane = .bot

  private enum SettingsPane: String {
    case bot
    case model
  }

  private var bot: Bot? {
    controller.bots.first(where: { $0.id == botId })
  }

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Image(systemName: "chevron.right.2")
          .font(.caption.weight(.semibold))
          .hidden()
        Spacer()
        Text("Settings")
          .font(.headline)
          .allowsHitTesting(false)
        Spacer()
        Button(action: onClose) {
          Image(systemName: "chevron.right.2")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
        }
        .buttonStyle(.plain)
        .help("Hide settings")
      }
      .padding(.horizontal, 16)
      .frame(height: 40)
      .frame(maxWidth: .infinity)
      .background(WindowDragArea())

      Rectangle()
        .fill(Color.white.opacity(0.10))
        .frame(height: 1)

      if let errorMessage {
        Text(errorMessage)
          .font(.caption)
          .foregroundStyle(.red)
          .padding(.horizontal, 16)
      }

      if let bot {
        ScrollView {
          VStack(alignment: .leading, spacing: 18) {
            HStack {
              Spacer()
              Button {
                isAvatarPickerPresented.toggle()
              } label: {
                BotAvatarView(bot: bot, size: 88, motion: .still)
              }
              .buttonStyle(.plain)
              .popover(isPresented: $isAvatarPickerPresented, arrowEdge: .bottom) {
                avatarPicker(bot)
                  .padding(14)
                  .frame(width: 320)
              }
              Spacer()
            }
            .padding(.top, 12)

            HStack {
              HStack(spacing: 0) {
                pickerCap("Bot", selected: pane == .bot) { pane = .bot }
                pickerCap("Model", selected: pane == .model) { pane = .model }
              }
              .padding(3)
              .background(Color.white.opacity(0.06))
              .clipShape(Capsule())
              Spacer(minLength: 0)
            }

            if pane == .bot {
              field("Name", text: $displayName, prompt: "News")
              field("Title", text: $title, prompt: "Describe what your Bot does")
              labeled("Description") {
                TextField("What this Bot is for", text: $job, axis: .vertical)
                  .textFieldStyle(.plain)
                  .lineLimit(3...6)
              }

              HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                  Text("Notifications")
                    .font(.body.weight(.semibold))
                  Text("Get notified when this Bot finishes or needs input")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                Toggle(
                  "",
                  isOn: Binding(
                    get: { bot.notificationsEnabled },
                    set: { try? controller.setNotificationsEnabled(id: bot.id, enabled: $0) }
                  )
                )
                .labelsHidden()
                .toggleStyle(.switch)
              }
              .padding(14)
              .background(Color.white.opacity(0.06))
              .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            } else {
              menuField(
                "Provider",
                selection: $provider,
                options: LlmCatalog.providers.map { ($0.id, $0.displayName) }
              )
              menuField(
                "Model",
                selection: $model,
                options: LlmCatalog.models(for: provider).map { ($0.id, $0.displayName) }
              )
              .onAppear {
                model = LlmCatalog.resolvedModel(providerId: provider, modelId: model)
              }
              menuField(
                "Thinking",
                selection: $thinking,
                options: [("off", "Off"), ("high", "High"), ("max", "Max")]
              )
              menuField(
                "Chat mode",
                selection: $chatSurfaceTag,
                options: [("inherit", "Default"), ("simple", "Simple"), ("advanced", "Advanced")]
              )
            }
          }
          .padding(.horizontal, 16)
          .padding(.bottom, 24)
        }
        .onDisappear { persist(bot) }
        .onChange(of: provider) { _, newValue in
          model = LlmCatalog.resolvedModel(providerId: newValue, modelId: model)
          persist(bot)
        }
        .onChange(of: model) { _, _ in persist(bot) }
        .onChange(of: thinking) { _, _ in persist(bot) }
        .onChange(of: chatSurfaceTag) { _, _ in persist(bot) }
      } else {
        Spacer()
        Text("Select a bot")
          .foregroundStyle(.secondary)
        Spacer()
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .background(Color.black.opacity(0.22))
    .onAppear { load(bot) }
    .onChange(of: botId) { _, _ in load(bot) }
    .fileImporter(
      isPresented: $isPickingAvatar,
      allowedContentTypes: [.png, .jpeg, .gif, .image],
      allowsMultipleSelection: false
    ) { result in
      guard let bot else { return }
      if case .success(let urls) = result, let url = urls.first {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        try? controller.setAvatarPath(id: bot.id, path: url.path)
      }
    }
  }

  private func field(_ label: String, text: Binding<String>, prompt: String) -> some View {
    labeled(label) {
      TextField(prompt, text: text)
        .textFieldStyle(.plain)
        .onSubmit { if let bot { persist(bot) } }
    }
  }

  private func menuField(
    _ label: String,
    selection: Binding<String>,
    options: [(String, String)]
  ) -> some View {
    let title = options.first(where: { $0.0 == selection.wrappedValue })?.1 ?? selection.wrappedValue
    return VStack(alignment: .leading, spacing: 6) {
      Text(label)
        .font(.caption)
        .foregroundStyle(.secondary)
      Menu {
        ForEach(options, id: \.0) { value, name in
          Button(name) { selection.wrappedValue = value }
        }
      } label: {
        HStack {
          Text(title)
            .foregroundStyle(.primary)
            .lineLimit(1)
          Spacer(minLength: 8)
          Image(systemName: "chevron.up.chevron.down")
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .menuIndicator(.hidden)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private func labeled<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(label)
        .font(.caption)
        .foregroundStyle(.secondary)
      content()
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.white.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
  }

  @ViewBuilder
  private func avatarPicker(_ bot: Bot) -> some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(spacing: 0) {
        pickerCap("Bot", selected: true) {}
        pickerCap("Generate", selected: false) {
          try? controller.generateBlobLook(id: bot.id)
        }
        pickerCap("Upload", selected: false) {
          isPickingAvatar = true
        }
        Spacer()
      }
      .padding(4)
      .background(Color.white.opacity(0.06))
      .clipShape(Capsule())

      LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 4), spacing: 12) {
        ForEach(BlobShape.allCases, id: \.self) { shape in
          let selected = bot.resolvedLook.shape == shape
          Button {
            apply(look: BlobLook(shape: shape, colorIndex: bot.resolvedLook.colorIndex), on: bot)
          } label: {
            BlobAvatar(
              seed: bot.id,
              size: 44,
              look: BlobLook(shape: shape, colorIndex: bot.resolvedLook.colorIndex),
              motion: .still
            )
            .padding(6)
            .overlay {
              Circle().stroke(selected ? Color.white.opacity(0.85) : Color.clear, lineWidth: 2)
            }
          }
          .buttonStyle(.plain)
        }
      }

      LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 6), spacing: 10) {
        ForEach(Array(blobPalette.enumerated()), id: \.offset) { index, rgb in
          let selected = bot.resolvedLook.colorIndex == index
          Button {
            apply(look: BlobLook(shape: bot.resolvedLook.shape, colorIndex: index), on: bot)
          } label: {
            Circle()
              .fill(Color(red: rgb.r, green: rgb.g, blue: rgb.b))
              .frame(width: 22, height: 22)
              .overlay {
                Circle().stroke(Color.white.opacity(selected ? 0.95 : 0.2), lineWidth: selected ? 2.5 : 1)
              }
          }
          .buttonStyle(.plain)
        }
      }
    }
  }

  private func pickerCap(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(title)
        .font(.caption.weight(selected ? .semibold : .regular))
        .foregroundStyle(selected ? Color.primary : Color.secondary)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(selected ? Color.white.opacity(0.14) : Color.clear)
        .clipShape(Capsule())
    }
    .buttonStyle(.plain)
  }

  private func apply(look: BlobLook, on bot: Bot) {
    try? controller.setBlobLook(id: bot.id, look: look)
  }

  private func load(_ bot: Bot?) {
    guard let bot else { return }
    displayName = bot.displayName
    title = bot.title
    job = bot.job
    provider = bot.provider
    model = LlmCatalog.resolvedModel(providerId: bot.provider, modelId: bot.model)
    thinking = bot.reasoningEffort
    chatSurfaceTag = bot.chatSurface?.rawValue ?? "inherit"
    errorMessage = nil
  }

  private func persist(_ bot: Bot) {
    guard !isSaving else { return }
    let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { return }
    isSaving = true
    Task {
      do {
        try await controller.updateBot(
          id: bot.id,
          displayName: name,
          title: title,
          job: job,
          provider: provider,
          model: model,
          thinking: thinking
        )
        try controller.setBotChatSurface(
          id: bot.id,
          chatSurface: ChatSurface(rawValue: chatSurfaceTag)
        )
      } catch {
        errorMessage = error.localizedDescription
      }
      isSaving = false
    }
  }
}
