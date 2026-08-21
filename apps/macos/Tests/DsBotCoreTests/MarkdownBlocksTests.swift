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

  func testSplitProseParagraphsOnBlankLines() {
    let source = """
    I'm DS Bot, a helpful and maximally truthful AI.

    I don't have a specific job title.

    If you have something specific you want help with, just tell me!
    """
    XCTAssertEqual(splitProseParagraphs(source), [
      "I'm DS Bot, a helpful and maximally truthful AI.",
      "I don't have a specific job title.",
      "If you have something specific you want help with, just tell me!",
    ])
  }

  func testSplitProseParagraphsKeepsSingleParagraph() {
    XCTAssertEqual(
      splitProseParagraphs("one line only"),
      ["one line only"]
    )
  }

  func testProseUsesBlockMarkdownDetectsListsAndHeadings() {
    XCTAssertTrue(proseUsesBlockMarkdown("- one\n- two"))
    XCTAssertTrue(proseUsesBlockMarkdown("## Title\nbody"))
    XCTAssertTrue(proseUsesBlockMarkdown("1. first\n2. second"))
    XCTAssertFalse(proseUsesBlockMarkdown("I'm DS Bot.\nI don't have a job title."))
  }

  func testGfmTableIsItsOwnBlock() {
    let source = """
    | Name | Role |
    | ---- | ---- |
    | DS Bot | AI |
    | Mark | Human |
    """
    let blocks = splitMarkdownBlocks(source)
    XCTAssertEqual(blocks.count, 1)
    guard case .table(let table) = blocks[0] else {
      return XCTFail("expected table, got \(blocks)")
    }
    XCTAssertEqual(table.headers, ["Name", "Role"])
    XCTAssertEqual(table.rows, [["DS Bot", "AI"], ["Mark", "Human"]])
    XCTAssertEqual(table.alignments, [.left, .left])
  }

  func testGfmTableAlignmentAndProseAroundIt() {
    let source = """
    Intro

    | Left | Mid | Right |
    | :--- | :---: | ---: |
    | a | b | c |

    Outro
    """
    let blocks = splitMarkdownBlocks(source)
    XCTAssertEqual(blocks.count, 3)
    XCTAssertEqual(blocks[0], .prose("Intro"))
    guard case .table(let table) = blocks[1] else {
      return XCTFail("expected table, got \(blocks[1])")
    }
    XCTAssertEqual(table.headers, ["Left", "Mid", "Right"])
    XCTAssertEqual(table.alignments, [.left, .center, .right])
    XCTAssertEqual(table.rows, [["a", "b", "c"]])
    XCTAssertEqual(blocks[2], .prose("Outro"))
  }

  func testPipeLineWithoutSeparatorStaysProse() {
    XCTAssertEqual(
      splitMarkdownBlocks("| not a table | still pipes |"),
      [.prose("| not a table | still pipes |")]
    )
  }

  func testShortRowsPadToHeaderCount() {
    let source = """
    | A | B | C |
    | --- | --- | --- |
    | 1 | 2 |
    """
    guard case .table(let table) = splitMarkdownBlocks(source).first else {
      return XCTFail("expected table")
    }
    XCTAssertEqual(table.rows, [["1", "2", ""]])
  }

  func testHeadingsListsQuotesAndRules() {
    let source = """
    ## Title

    A paragraph.

    - alpha
    - **beta**

    1. one
    2. two

    > quoted
    > line

    ---

    Trailing
    """
    let blocks = splitMarkdownBlocks(source)
    XCTAssertEqual(blocks[0], .heading(level: 2, text: "Title"))
    XCTAssertEqual(blocks[1], .prose("A paragraph."))
    guard case .list(let unordered, let ulStart, let bullets) = blocks[2] else {
      return XCTFail("expected ul, got \(blocks[2])")
    }
    XCTAssertFalse(unordered)
    XCTAssertEqual(ulStart, 1)
    XCTAssertEqual(bullets.map(\.text), ["alpha", "**beta**"])
    XCTAssertEqual(bullets.map(\.checked), [nil, nil])
    guard case .list(let ordered, let olStart, let numbers) = blocks[3] else {
      return XCTFail("expected ol, got \(blocks[3])")
    }
    XCTAssertTrue(ordered)
    XCTAssertEqual(olStart, 1)
    XCTAssertEqual(numbers.map(\.text), ["one", "two"])
    XCTAssertEqual(blocks[4], .quote("quoted\nline"))
    XCTAssertEqual(blocks[5], .rule)
    XCTAssertEqual(blocks[6], .prose("Trailing"))
  }

  func testTaskListItems() {
    let source = """
    - [ ] todo
    - [x] done
    """
    guard case .list(let ordered, _, let items) = splitMarkdownBlocks(source).first else {
      return XCTFail("expected list")
    }
    XCTAssertFalse(ordered)
    XCTAssertEqual(items.map(\.text), ["todo", "done"])
    XCTAssertEqual(items.map(\.checked), [false, true])
  }

  func testStrikethroughSpans() {
    let spans = splitStrikethroughSpans("keep ~~gone~~ **bold**")
    XCTAssertEqual(spans, [
      MarkdownSpan(text: "keep ", struck: false),
      MarkdownSpan(text: "gone", struck: true),
      MarkdownSpan(text: " **bold**", struck: false),
    ])
  }

  func testTableAfterCodeFence() {
    let source = """
    ```
    x
    ```
    | A |
    | --- |
    | 1 |
    """
    let blocks = splitMarkdownBlocks(source)
    XCTAssertEqual(blocks.count, 2)
    XCTAssertEqual(blocks[0], .code(language: nil, source: "x"))
    guard case .table(let table) = blocks[1] else {
      return XCTFail("expected table after fence, got \(blocks)")
    }
    XCTAssertEqual(table.headers, ["A"])
    XCTAssertEqual(table.rows, [["1"]])
  }
  func testSplitSettledTailSplitsAtLastParagraphBoundary() {
    let (settled, tail) = splitSettledTail("First para.\n\nSecond para.\n\nIn progress")
    XCTAssertEqual(settled, "First para.\n\nSecond para.")
    XCTAssertEqual(tail, "In progress")
  }

  func testSplitSettledTailKeepsEverythingPendingWithoutABoundary() {
    let (settled, tail) = splitSettledTail("only one paragraph so far")
    XCTAssertEqual(settled, "")
    XCTAssertEqual(tail, "only one paragraph so far")
  }

  func testSplitSettledTailNeverSettlesInsideAnOpenFence() {
    let (settled, tail) = splitSettledTail("Intro.\n\n```swift\nlet a = 1\n\nlet b = 2")
    XCTAssertEqual(settled, "Intro.")
    XCTAssertEqual(tail, "```swift\nlet a = 1\n\nlet b = 2")
  }

  func testSplitSettledTailSettlesAfterAClosedFence() {
    let (settled, tail) = splitSettledTail("```swift\nlet a = 1\n```\n\nAfter")
    XCTAssertEqual(settled, "```swift\nlet a = 1\n```")
    XCTAssertEqual(tail, "After")
  }

}
