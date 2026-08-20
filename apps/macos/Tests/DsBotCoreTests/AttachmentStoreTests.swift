import Foundation
import XCTest
@testable import DsBotCore

final class AttachmentStoreTests: XCTestCase {
  private func temporaryDirectory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("uploads-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  func testIngestCopiesIntoSharedUploadsAndUniquifies() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let workspace = root.appendingPathComponent("workspace")
    try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
    let sourceDir = root.appendingPathComponent("src")
    try FileManager.default.createDirectory(at: sourceDir, withIntermediateDirectories: true)
    let a = sourceDir.appendingPathComponent("notes.txt")
    try "hello".write(to: a, atomically: true, encoding: .utf8)

    let first = try AttachmentStore.ingest(urls: [a], workspace: workspace)
    XCTAssertEqual(first.count, 1)
    XCTAssertEqual(first[0].originalName, "notes.txt")
    XCTAssertEqual(first[0].relativePath, "uploads/notes.txt")
    XCTAssertEqual(
      try String(contentsOf: workspace.appendingPathComponent("uploads/notes.txt"), encoding: .utf8),
      "hello"
    )

    try "second".write(to: a, atomically: true, encoding: .utf8)
    let second = try AttachmentStore.ingest(urls: [a], workspace: workspace)
    XCTAssertEqual(second[0].relativePath, "uploads/notes-2.txt")
    XCTAssertTrue(FileManager.default.fileExists(atPath: workspace.appendingPathComponent("uploads/notes.txt").path))
    XCTAssertTrue(FileManager.default.fileExists(atPath: workspace.appendingPathComponent("uploads/notes-2.txt").path))
  }

  func testRejectsTooManyAndTooLarge() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let workspace = root.appendingPathComponent("workspace")
    try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
    let urls = (0..<7).map { i in root.appendingPathComponent("f\(i).txt") }
    for url in urls {
      try "x".write(to: url, atomically: true, encoding: .utf8)
    }
    XCTAssertThrowsError(try AttachmentStore.ingest(urls: urls, workspace: workspace)) { error in
      XCTAssertEqual(error as? AttachmentStoreError, .tooMany)
    }
  }

  func testPromptSuffixListsSharedPaths() {
    let files = [
      ChatAttachment(originalName: "a.pdf", relativePath: "uploads/a.pdf", byteCount: 10),
      ChatAttachment(originalName: "b.txt", relativePath: "uploads/b.txt", byteCount: 4),
    ]
    let suffix = AttachmentStore.promptSuffix(for: files)
    XCTAssertTrue(suffix.contains("uploads/a.pdf"))
    XCTAssertTrue(suffix.contains("uploads/b.txt"))
    XCTAssertTrue(suffix.contains("working directory"))
    XCTAssertFalse(suffix.contains("("))
  }

  func testProjectTranscriptKeepsUserAttachments() {
    let attachment = ChatAttachment(
      id: "att-1",
      originalName: "spec.md",
      relativePath: "uploads/spec.md",
      byteCount: 12
    )
    let events = [
      SessionEventDTO(
        type: "user/message",
        seq: 1,
        data: .object([
          "source": .object(["kind": .string("user")]),
          "content": .array([.object(["type": .string("text"), "text": .string("read this")])]),
          "attachments": .array([attachment.jsonValue]),
        ])
      ),
    ]
    let items = projectTranscript(events)
    guard case .user(_, _, let text, let files) = items.first else {
      return XCTFail("expected user row")
    }
    XCTAssertEqual(text, "read this")
    XCTAssertEqual(files, [attachment])
  }
}
