import SwiftUI
import DsBotCore

public struct CreateBotSheet: View {
  var controller: SessionController
  var editingBot: Bot?
  @Binding var isPresented: Bool

  @State private var displayName = ""
  @State private var job = ""
  @State private var model = "cline-pass/deepseek-v4-flash"
  @State private var thinking = "off"
  @State private var template = "code"
  @State private var isSubmitting = false
  @State private var errorMessage: String?

  public init(controller: SessionController, editingBot: Bot? = nil, isPresented: Binding<Bool>) {
    self.controller = controller
    self.editingBot = editingBot
    self._isPresented = isPresented
  }

  private var isEditing: Bool { editingBot != nil }

  public var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(isEditing ? "Settings" : "Create Bot")
        .font(.title2)
        .fontWeight(.bold)

      if let error = errorMessage {
        Text(error)
          .font(.caption)
          .foregroundColor(.red)
          .padding(8)
          .background(Color.red.opacity(0.1))
          .cornerRadius(6)
      }

      Form {
        TextField("Display Name:", text: $displayName, prompt: Text("e.g. Code Reviewer"))

        VStack(alignment: .leading, spacing: 4) {
          Text("Job Persona:")
            .font(.caption)
            .foregroundColor(.secondary)
          TextEditor(text: $job)
            .font(.body)
            .frame(minHeight: 80, maxHeight: 140)
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.secondary.opacity(0.3)))
        }

        Picker("Model:", selection: $model) {
          Text("DeepSeek V4 Flash").tag("cline-pass/deepseek-v4-flash")
          Text("DeepSeek V4 Pro").tag("cline-pass/deepseek-v4-pro")
        }

        Picker("Thinking:", selection: $thinking) {
          Text("Off").tag("off")
          Text("High").tag("high")
          Text("Max").tag("max")
        }

        if !isEditing {
          TextField("Template Preset:", text: $template, prompt: Text("code"))
        }
      }

      HStack {
        Button("Cancel") {
          isPresented = false
        }
        .keyboardShortcut(.cancelAction)

        Spacer()

        Button(isEditing ? "Save" : "Create") {
          Task {
            isSubmitting = true
            errorMessage = nil
            do {
              if let editingBot {
                try await controller.updateBot(
                  id: editingBot.id,
                  displayName: displayName,
                  job: job,
                  provider: editingBot.provider,
                  model: model,
                  thinking: thinking
                )
              } else {
                try await controller.createBot(
                  displayName: displayName,
                  job: job,
                  provider: "cline-pass",
                  model: model,
                  thinking: thinking,
                  template: template.isEmpty ? "code" : template
                )
              }
              isPresented = false
            } catch {
              errorMessage = error.localizedDescription
            }
            isSubmitting = false
          }
        }
        .buttonStyle(.borderedProminent)
        .disabled(displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSubmitting)
        .keyboardShortcut(.defaultAction)
      }
    }
    .padding(20)
    .frame(minWidth: 440, maxWidth: 520)
    .onAppear {
      if let editingBot {
        displayName = editingBot.displayName
        job = editingBot.job
        model = editingBot.model
        thinking = editingBot.reasoningEffort
      }
    }
  }
}
