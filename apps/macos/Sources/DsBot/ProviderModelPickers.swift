import SwiftUI
import DsBotCore

struct ProviderModelPickers: View {
  @Binding var provider: String
  @Binding var model: String

  var body: some View {
    Picker("Provider", selection: $provider) {
      ForEach(LlmCatalog.providers) { entry in
        Text(entry.displayName).tag(entry.id)
      }
    }
    .onChange(of: provider) { _, newValue in
      model = LlmCatalog.resolvedModel(providerId: newValue, modelId: model)
    }
    Picker("Model", selection: $model) {
      ForEach(LlmCatalog.models(for: provider)) { entry in
        Text(entry.displayName).tag(entry.id)
      }
    }
    .onAppear {
      model = LlmCatalog.resolvedModel(providerId: provider, modelId: model)
    }
  }
}
