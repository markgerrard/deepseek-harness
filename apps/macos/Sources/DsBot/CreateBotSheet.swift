import SwiftUI
import DsBotCore

public struct CreateBotSheet: View {
  var controller: SessionController
  @Binding var isPresented: Bool

  @State private var displayName = ""
  @State private var job = ""
  @State private var provider = "mock"
  @State private var model = "m"
  @State private var thinking = "off"
  @State private var template = "code"
  @State private var isSubmitting = false
  @State private var errorMessage: String?

  public init(controller: SessionController, isPresented: Binding<Bool>) {
    self.controller = controller
    self._isPresented = isPresented
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Create Bot")
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

        TextField("Provider:", text: $provider, prompt: Text("e.g. deepseek-official"))
        TextField("Model:", text: $model, prompt: Text("e.g. deepseek-v4-flash"))

        Picker("Thinking:", selection: $thinking) {
          Text("Off").tag("off")
          Text("High").tag("high")
          Text("Max").tag("max")
        }

        TextField("Template Preset:", text: $template, prompt: Text("code"))
      }

      HStack {
        Button("Cancel") {
          isPresented = false
        }
        .keyboardShortcut(.cancelAction)

        Spacer()

        Button("Create") {
          Task {
            isSubmitting = true
            errorMessage = nil
            do {
              try await controller.createBot(
                displayName: displayName,
                job: job,
                provider: provider,
                model: model,
                thinking: thinking,
                template: template.isEmpty ? "code" : template
              )
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
  }
}
