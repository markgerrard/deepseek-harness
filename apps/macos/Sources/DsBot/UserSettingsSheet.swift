import SwiftUI
import DsBotCore

/// Full-size settings sheet with a left nav (General / Providers / API keys)
/// so no pane is a long scroll. One Save applies every tab.
struct UserSettingsSheet: View {
  var controller: SessionController
  @Binding var isPresented: Bool

  private enum Tab: String, CaseIterable, Identifiable {
    case general, providers, keys

    var id: String { rawValue }

    var title: String {
      switch self {
      case .general: return "General"
      case .providers: return "Providers"
      case .keys: return "API keys"
      }
    }

    var icon: String {
      switch self {
      case .general: return "gearshape"
      case .providers: return "shippingbox"
      case .keys: return "key"
      }
    }
  }

  @State private var selectedTab: Tab = .general
  @State private var userName = ""
  @State private var clineKey = ""
  @State private var opencodeKey = ""
  @State private var chatSurface: ChatSurface = .simple
  @State private var savedClineMask: String?
  @State private var savedOpencodeMask: String?
  @State private var errorMessage: String?
  @State private var didSave = false

  var body: some View {
    HStack(spacing: 0) {
      navPane
      Rectangle()
        .fill(Color.white.opacity(0.08))
        .frame(width: 1)

      VStack(alignment: .leading, spacing: 16) {
        HStack {
          Text(selectedTab.title)
            .font(.title2.weight(.bold))
          Spacer()
          Button {
            isPresented = false
          } label: {
            Image(systemName: "xmark")
              .font(.system(size: 13, weight: .semibold))
              .foregroundStyle(.secondary)
          }
          .buttonStyle(.plain)
          .keyboardShortcut(.cancelAction)
          .help("Close")
        }

        if let errorMessage {
          Text(errorMessage)
            .font(.caption)
            .foregroundStyle(.red)
        } else if didSave {
          Text("Saved. New chats pick up keys on the next app launch.")
            .font(.caption)
            .foregroundStyle(.secondary)
        }

        ScrollView {
          content
            .frame(maxWidth: .infinity, alignment: .leading)
        }

        HStack {
          Spacer()
          Button("Save") { save() }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.defaultAction)
        }
      }
      .padding(20)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .frame(minWidth: 760, minHeight: 560)
    .onAppear(perform: load)
  }

  private var navPane: some View {
    VStack(alignment: .leading, spacing: 2) {
      ForEach(Tab.allCases) { tab in
        Button {
          selectedTab = tab
        } label: {
          HStack(spacing: 8) {
            Image(systemName: tab.icon)
              .frame(width: 18)
            Text(tab.title)
            Spacer(minLength: 0)
          }
          .padding(.horizontal, 10)
          .padding(.vertical, 7)
          .contentShape(Rectangle())
          .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
              .fill(selectedTab == tab ? Color.white.opacity(0.10) : Color.clear)
          )
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
      }
      Spacer()
    }
    .padding(12)
    .frame(width: 190)
  }

  @ViewBuilder
  private var content: some View {
    switch selectedTab {
    case .general:
      VStack(alignment: .leading, spacing: 20) {
        settingsCard {
          HStack(spacing: 12) {
            UserAvatarCircle(name: userName, size: 44)
            VStack(alignment: .leading, spacing: 4) {
              Text("Name")
                .font(.caption)
                .foregroundStyle(.secondary)
              TextField("Name", text: $userName)
                .textFieldStyle(.plain)
            }
          }
          .padding(14)
        } header: {
          Text("User")
        }

        settingsCard {
          Picker("Chat", selection: $chatSurface) {
            Text("Simple").tag(ChatSurface.simple)
            Text("Advanced").tag(ChatSurface.advanced)
          }
          .pickerStyle(.radioGroup)
          .padding(14)
        } header: {
          Text("Chat surface")
        } footer: {
          Text("Simple hides thinking and tool calls. A bot can override this in its settings.")
        }
      }
    case .providers:
      settingsCard {
        VStack(alignment: .leading, spacing: 10) {
          providerRow("Cline Pass", detail: "DeepSeek V4, GLM, Kimi, Qwen…")
          Divider().overlay(Color.white.opacity(0.08))
          providerRow("OpenCode Go", detail: "Subscription chat models")
          Divider().overlay(Color.white.opacity(0.08))
          providerRow("OpenCode Zen", detail: "Pay-as-you-go chat models")
        }
        .padding(14)
      } header: {
        Text("Providers")
      } footer: {
        Text("Each bot picks Cline Pass, OpenCode Go, or OpenCode Zen in its settings. Go and Zen share the OpenCode API key.")
      }
    case .keys:
      settingsCard {
        VStack(alignment: .leading, spacing: 12) {
          keyField("Cline Pass API key", text: $clineKey, savedMask: savedClineMask)
          keyField("OpenCode API key", text: $opencodeKey, savedMask: savedOpencodeMask)
        }
        .padding(14)
      } header: {
        Text("API keys")
      } footer: {
        Text("Stored in ~/.dsh/.credentials.yaml (mode 0600). Leave a field blank to keep the current key.")
      }
    }
  }

  private func providerRow(_ name: String, detail: String) -> some View {
    HStack {
      Text(name)
      Spacer()
      Text(detail)
        .foregroundStyle(.secondary)
    }
  }

  private func keyField(_ label: String, text: Binding<String>, savedMask: String?) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      SecureField(label, text: text)
        .textFieldStyle(.plain)
      if let savedMask, text.wrappedValue.isEmpty {
        Text("Saved \(savedMask)")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
  }

  /// Rounded card with an optional small header above and footer below,
  /// mirroring the reference product's grouped sections.
  private func settingsCard<Content: View, Header: View>(
    @ViewBuilder content: () -> Content,
    @ViewBuilder header: () -> Header
  ) -> some View {
    settingsCard(content: content, header: header, footer: { EmptyView() })
  }

  private func settingsCard<Content: View, Header: View, Footer: View>(
    @ViewBuilder content: () -> Content,
    @ViewBuilder header: () -> Header,
    @ViewBuilder footer: () -> Footer
  ) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      header()
        .font(.callout)
        .foregroundStyle(.secondary)
      content()
        .background(
          RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.05))
        )
        .overlay(
          RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(Color.white.opacity(0.08))
        )
      footer()
        .font(.caption)
        .foregroundStyle(.secondary)
    }
  }

  private func load() {
    let map = LaunchCredentials.loadCredentialMap()
    savedClineMask = LaunchCredentials.maskedSecret(map["CLINE_API_KEY"])
    savedOpencodeMask = LaunchCredentials.maskedSecret(map["OPENCODE_API_KEY"])
    chatSurface = controller.settings.settings.chatSurface
    userName = controller.settings.settings.userName
  }

  private func save() {
    errorMessage = nil
    didSave = false
    var map = LaunchCredentials.loadCredentialMap()
    let cline = clineKey.trimmingCharacters(in: .whitespacesAndNewlines)
    let opencode = opencodeKey.trimmingCharacters(in: .whitespacesAndNewlines)
    if !cline.isEmpty { map["CLINE_API_KEY"] = cline }
    if !opencode.isEmpty { map["OPENCODE_API_KEY"] = opencode }
    do {
      try LaunchCredentials.saveCredentialMap(map)
      try controller.setAccountChatSurface(chatSurface)
      try controller.setUserName(userName)
      clineKey = ""
      opencodeKey = ""
      load()
      didSave = true
    } catch {
      errorMessage = "Could not save settings."
    }
  }
}

/// Dark circle with the user's first initial, per the reference product's
/// profile row.
struct UserAvatarCircle: View {
  let name: String
  let size: CGFloat

  private var initial: String {
    String(name.trimmingCharacters(in: .whitespaces).first.map(String.init) ?? "?").uppercased()
  }

  var body: some View {
    ZStack {
      Circle().fill(Color.white.opacity(0.14))
      Text(initial)
        .font(.system(size: size * 0.42, weight: .medium))
        .foregroundStyle(.primary)
    }
    .frame(width: size, height: size)
  }
}
