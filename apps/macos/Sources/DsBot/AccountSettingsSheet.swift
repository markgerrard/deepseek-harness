import SwiftUI
import DsBotCore

struct AccountSettingsSheet: View {
  var controller: SessionController
  @Binding var isPresented: Bool
  @State private var clineKey = ""
  @State private var opencodeKey = ""
  @State private var chatSurface: ChatSurface = .simple
  @State private var savedClineMask: String?
  @State private var savedOpencodeMask: String?
  @State private var errorMessage: String?
  @State private var didSave = false

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Settings")
        .font(.title2)
        .fontWeight(.bold)

      if let errorMessage {
        Text(errorMessage)
          .font(.caption)
          .foregroundStyle(.red)
      } else if didSave {
        Text("Saved. New chats pick up keys on the next app launch.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }

      Form {
        Section {
          LabeledContent("Provider") {
            Text("Cline Pass")
              .foregroundStyle(.secondary)
          }
          LabeledContent("Models") {
            Text("DeepSeek V4 Flash / Pro")
              .foregroundStyle(.secondary)
          }
        } header: {
          Text("Providers")
        } footer: {
          Text("Bots use this account provider. Per-bot settings only change name, job, model, thinking, and chat.")
        }

        Section {
          Picker("Chat", selection: $chatSurface) {
            Text("Simple").tag(ChatSurface.simple)
            Text("Advanced").tag(ChatSurface.advanced)
          }
        } header: {
          Text("Chat")
        } footer: {
          Text("Simple hides thinking and tool calls. A bot can override this in its settings.")
        }

        Section {
          SecureField("Cline Pass API key", text: $clineKey)
          if let savedClineMask, clineKey.isEmpty {
            Text("Saved \(savedClineMask)")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
          SecureField("OpenCode API key", text: $opencodeKey)
          if let savedOpencodeMask, opencodeKey.isEmpty {
            Text("Saved \(savedOpencodeMask)")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        } header: {
          Text("API keys")
        } footer: {
          Text("Stored in ~/.dsh/.credentials.yaml (mode 0600). Leave a field blank to keep the current key.")
        }
      }
      .formStyle(.grouped)

      HStack {
        Button("Cancel") {
          isPresented = false
        }
        .keyboardShortcut(.cancelAction)
        Spacer()
        Button("Save") {
          save()
        }
        .buttonStyle(.borderedProminent)
        .keyboardShortcut(.defaultAction)
      }
    }
    .padding(20)
    .frame(minWidth: 460, minHeight: 420)
    .onAppear(perform: load)
  }

  private func load() {
    let map = LaunchCredentials.loadCredentialMap()
    savedClineMask = LaunchCredentials.maskedSecret(map["CLINE_API_KEY"])
    savedOpencodeMask = LaunchCredentials.maskedSecret(map["OPENCODE_API_KEY"])
    chatSurface = controller.settings.settings.chatSurface
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
      clineKey = ""
      opencodeKey = ""
      load()
      didSave = true
    } catch {
      errorMessage = "Could not save settings."
    }
  }
}
