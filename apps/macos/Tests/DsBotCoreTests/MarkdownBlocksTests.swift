import XCTest
@testable import DsBotCore

final class MarkdownBlocksTests: XCTestCase {
  func testPlainProseIsOneBlock() {
    XCTAssertEqual(splitMarkdownBlocks("hello **world**"), [.prose("hello **world**")])
  }

  func testFencedCodeWithLanguage() {
    let source = """
    intro

    ```swift
    let x = 1
    ```

    outro
    """
    XCTAssertEqual(splitMarkdownBlocks(source), [
      .prose("intro"),
      .code(language: "swift", source: "let x = 1"),
      .prose("outro"),
    ])
  }

  func testUnclosedFenceIsCode() {
    XCTAssertEqual(
      splitMarkdownBlocks("```python\nprint(1)\n"),
      [.code(language: "python", source: "print(1)\n")]
    )
  }

  func testEmptySource() {
    XCTAssertEqual(splitMarkdownBlocks(""), [])
  }

  func testFenceWithoutLanguage() {
    XCTAssertEqual(
      splitMarkdownBlocks("```\nplain\n```"),
      [.code(language: nil, source: "plain")]
    )
  }
}
