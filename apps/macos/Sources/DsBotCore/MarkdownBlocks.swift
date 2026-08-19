import Foundation

public enum MarkdownBlock: Equatable, Sendable {
  case prose(String)
  case code(language: String?, source: String)
}

/// Split CommonMark fenced code from surrounding prose so the UI can style
/// fences as code cards. Unclosed fences (streaming) stay a code block.
public func splitMarkdownBlocks(_ source: String) -> [MarkdownBlock] {
  var blocks: [MarkdownBlock] = []
  var rest = source[...]

  while let open = rest.range(of: "```") {
    let before = String(rest[..<open.lowerBound])
    appendProse(before, into: &blocks)

    var after = rest[open.upperBound...]
    let info: String
    if let newline = after.firstIndex(of: "\n") {
      info = String(after[..<newline]).trimmingCharacters(in: .whitespacesAndNewlines)
      after = after[after.index(after: newline)...]
    } else {
      info = String(after).trimmingCharacters(in: .whitespacesAndNewlines)
      blocks.append(.code(language: emptyToNil(info), source: ""))
      return blocks
    }

    if let close = after.range(of: "```") {
      var code = String(after[..<close.lowerBound])
      if code.hasSuffix("\n") {
        code.removeLast()
      }
      blocks.append(.code(language: emptyToNil(info), source: code))
      rest = after[close.upperBound...]
      if rest.first == "\n" {
        rest = rest.dropFirst()
      }
    } else {
      blocks.append(.code(language: emptyToNil(info), source: String(after)))
      return blocks
    }
  }

  appendProse(String(rest), into: &blocks)
  if blocks.isEmpty, !source.isEmpty {
    blocks.append(.prose(source))
  }
  return blocks
}

private func emptyToNil(_ value: String) -> String? {
  value.isEmpty ? nil : value
}

private func appendProse(_ text: String, into blocks: inout [MarkdownBlock]) {
  let trimmed = text.trimmingCharacters(in: .newlines)
  if trimmed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return }
  blocks.append(.prose(trimmed))
}
