import XCTest
@testable import DsBotCore

final class LlmCatalogTests: XCTestCase {
  func testCatalogExposesClineAndOpenCode() {
    XCTAssertEqual(LlmCatalog.providers.map(\.id), ["cline-pass", "opencode-go", "opencode-zen"])
    XCTAssertEqual(LlmCatalog.defaultProviderId, "cline-pass")
    XCTAssertTrue(LlmCatalog.models(for: "cline-pass").contains(where: { $0.id == "cline-pass/deepseek-v4-flash" }))
    XCTAssertTrue(LlmCatalog.models(for: "opencode-go").contains(where: { $0.id == "deepseek-v4-flash" }))
    XCTAssertTrue(LlmCatalog.models(for: "opencode-zen").contains(where: { $0.id == "deepseek-v4-flash" }))
    XCTAssertTrue(LlmCatalog.models(for: "opencode-zen").contains(where: { $0.id == "big-pickle" }))
  }

  func testResolvedModelKeepsValidSelection() {
    XCTAssertEqual(
      LlmCatalog.resolvedModel(providerId: "cline-pass", modelId: "cline-pass/deepseek-v4-pro"),
      "cline-pass/deepseek-v4-pro"
    )
  }

  func testResolvedModelMapsAcrossProvidersBySuffix() {
    XCTAssertEqual(
      LlmCatalog.resolvedModel(providerId: "opencode-go", modelId: "cline-pass/deepseek-v4-flash"),
      "deepseek-v4-flash"
    )
    XCTAssertEqual(
      LlmCatalog.resolvedModel(providerId: "cline-pass", modelId: "deepseek-v4-pro"),
      "cline-pass/deepseek-v4-pro"
    )
  }

  func testResolvedModelFallsBackToProviderDefault() {
    XCTAssertEqual(
      LlmCatalog.resolvedModel(providerId: "opencode-go", modelId: "cline-pass/qwen3.8-max"),
      "deepseek-v4-flash"
    )
    XCTAssertEqual(
      LlmCatalog.resolvedModel(providerId: "opencode-zen", modelId: "cline-pass/deepseek-v4-pro"),
      "deepseek-v4-pro"
    )
  }
}
