import Foundation

public struct LlmModel: Equatable, Sendable, Identifiable {
  public var id: String
  public var displayName: String

  public init(id: String, displayName: String) {
    self.id = id
    self.displayName = displayName
  }
}

public struct LlmProvider: Equatable, Sendable, Identifiable {
  public var id: String
  public var displayName: String
  public var models: [LlmModel]

  public init(id: String, displayName: String, models: [LlmModel]) {
    self.id = id
    self.displayName = displayName
    self.models = models
  }
}

public enum LlmCatalog: Sendable {
  public static let defaultProviderId = "cline-pass"

  public static let providers: [LlmProvider] = [
    LlmProvider(
      id: "cline-pass",
      displayName: "Cline Pass",
      models: [
        LlmModel(id: "cline-pass/deepseek-v4-flash", displayName: "DeepSeek V4 Flash"),
        LlmModel(id: "cline-pass/deepseek-v4-pro", displayName: "DeepSeek V4 Pro"),
        LlmModel(id: "cline-pass/glm-5.2", displayName: "GLM 5.2"),
        LlmModel(id: "cline-pass/kimi-k3", displayName: "Kimi K3"),
        LlmModel(id: "cline-pass/kimi-k2.7-code", displayName: "Kimi K2.7 Code"),
        LlmModel(id: "cline-pass/kimi-k2.6", displayName: "Kimi K2.6"),
        LlmModel(id: "cline-pass/mimo-v2.5", displayName: "MiMo V2.5"),
        LlmModel(id: "cline-pass/mimo-v2.5-pro", displayName: "MiMo V2.5 Pro"),
        LlmModel(id: "cline-pass/minimax-m3", displayName: "MiniMax M3"),
        LlmModel(id: "cline-pass/qwen3.8-max", displayName: "Qwen 3.8 Max"),
        LlmModel(id: "cline-pass/qwen3.7-max", displayName: "Qwen 3.7 Max"),
        LlmModel(id: "cline-pass/qwen3.7-plus", displayName: "Qwen 3.7 Plus"),
      ]
    ),
    LlmProvider(
      id: "opencode-go",
      displayName: "OpenCode Go",
      models: [
        LlmModel(id: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash"),
        LlmModel(id: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro"),
        LlmModel(id: "glm-5.3", displayName: "GLM 5.3"),
        LlmModel(id: "glm-5.2", displayName: "GLM 5.2"),
        LlmModel(id: "glm-5.1", displayName: "GLM 5.1"),
        LlmModel(id: "kimi-k3", displayName: "Kimi K3"),
        LlmModel(id: "kimi-k2.7-code", displayName: "Kimi K2.7 Code"),
        LlmModel(id: "kimi-k2.6", displayName: "Kimi K2.6"),
        LlmModel(id: "mimo-v2.5", displayName: "MiMo V2.5"),
        LlmModel(id: "mimo-v2.5-pro", displayName: "MiMo V2.5 Pro"),
        LlmModel(id: "hy3", displayName: "HY3"),
      ]
    ),
    LlmProvider(
      id: "opencode-zen",
      displayName: "OpenCode Zen",
      models: [
        LlmModel(id: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash"),
        LlmModel(id: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro"),
        LlmModel(id: "glm-5.2", displayName: "GLM 5.2"),
        LlmModel(id: "glm-5.1", displayName: "GLM 5.1"),
        LlmModel(id: "glm-5", displayName: "GLM 5"),
        LlmModel(id: "kimi-k3", displayName: "Kimi K3"),
        LlmModel(id: "kimi-k2.7-code", displayName: "Kimi K2.7 Code"),
        LlmModel(id: "kimi-k2.6", displayName: "Kimi K2.6"),
        LlmModel(id: "kimi-k2.5", displayName: "Kimi K2.5"),
        LlmModel(id: "minimax-m3", displayName: "MiniMax M3"),
        LlmModel(id: "minimax-m2.7", displayName: "MiniMax M2.7"),
        LlmModel(id: "minimax-m2.5", displayName: "MiniMax M2.5"),
        LlmModel(id: "big-pickle", displayName: "Big Pickle"),
        LlmModel(id: "mimo-v2.5-free", displayName: "MiMo V2.5 Free"),
        LlmModel(id: "hy3-free", displayName: "HY3 Free"),
        LlmModel(id: "x-preview-f-free", displayName: "Ox Alpha Free"),
        LlmModel(id: "nemotron-3-ultra-free", displayName: "Nemotron 3 Ultra Free"),
        LlmModel(id: "nemotron-3.5-lightning-free", displayName: "Nemotron 3.5 Lightning Free"),
      ]
    ),
  ]

  public static func provider(id: String) -> LlmProvider? {
    providers.first(where: { $0.id == id })
  }

  public static func models(for providerId: String) -> [LlmModel] {
    provider(id: providerId)?.models ?? []
  }

  public static func defaultModelId(for providerId: String) -> String {
    switch providerId {
    case "opencode-go", "opencode-zen": return "deepseek-v4-flash"
    default: return "cline-pass/deepseek-v4-flash"
    }
  }

  public static func resolvedModel(providerId: String, modelId: String) -> String {
    let models = models(for: providerId)
    if models.contains(where: { $0.id == modelId }) { return modelId }
    let suffix = modelId.split(separator: "/").last.map(String.init) ?? modelId
    if let match = models.first(where: {
      $0.id == suffix || $0.id.hasSuffix("/\(suffix)")
    }) {
      return match.id
    }
    return defaultModelId(for: providerId)
  }
}
