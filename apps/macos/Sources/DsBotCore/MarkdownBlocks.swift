import Foundation

public enum MarkdownTableAlignment: Equatable, Sendable {
  case left
  case center
  case right
}

public struct MarkdownTable: Equatable, Sendable {
  public var headers: [String]
  public var alignments: [MarkdownTableAlignment]
  public var rows: [[String]]

  public init(
    headers: [String],
    alignments: [MarkdownTableAlignment] = [],
    rows: [[String]] = []
  ) {
    let width = headers.count
    self.headers = headers
    self.alignments = (0..<width).map { index in
      index < alignments.count ? alignments[index] : .left
    }
    self.rows = rows.map { normalizeRow($0, width: width) }
  }

  public func alignment(at index: Int) -> MarkdownTableAlignment {
    (index >= 0 && index < alignments.count) ? alignments[index] : .left
  }
}

public struct MarkdownListItem: Equatable, Sendable {
  public var text: String
  public var checked: Bool?

  public init(text: String, checked: Bool? = nil) {
    self.text = text
    self.checked = checked
  }
}

public struct MarkdownSpan: Equatable, Sendable {
  public var text: String
  public var struck: Bool

  public init(text: String, struck: Bool) {
    self.text = text
    self.struck = struck
  }
}

public enum MarkdownBlock: Equatable, Sendable {
  case prose(String)
  case code(language: String?, source: String)
  case table(MarkdownTable)
  case heading(level: Int, text: String)
  case quote(String)
  case list(ordered: Bool, start: Int, items: [MarkdownListItem])
  case rule
}

/// Split CommonMark fenced code from surrounding prose so the UI can style
/// fences as code cards. Unclosed fences (streaming) stay a code block.
public func splitMarkdownBlocks(_ source: String) -> [MarkdownBlock] {
  var blocks: [MarkdownBlock] = []
  var rest = source[...]

  while let open = rest.range(of: "```") {
    let before = String(rest[..<open.lowerBound])
    blocks.append(contentsOf: extractTableBlocks(before))

    var after = rest[open.upperBound...]
    let info: String
    if let newline = after.firstIndex(of: "\n") {
      info = String(after[..<newline]).trimmingCharacters(in: .whitespacesAndNewlines)
      after = after[after.index(after: newline)...]
    } else {
      info = String(after).trimmingCharacters(in: .whitespacesAndNewlines)
      blocks.append(.code(language: emptyToNil(info), source: ""))
      return finishMarkdownBlocks(blocks, source: source)
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
      return finishMarkdownBlocks(blocks, source: source)
    }
  }

  blocks.append(contentsOf: extractTableBlocks(String(rest)))
  return finishMarkdownBlocks(blocks, source: source)
}

private func finishMarkdownBlocks(_ blocks: [MarkdownBlock], source: String) -> [MarkdownBlock] {
  var expanded: [MarkdownBlock] = []
  for block in blocks {
    if case .prose(let text) = block {
      expanded.append(contentsOf: extractStructureBlocks(text))
    } else {
      expanded.append(block)
    }
  }
  if expanded.isEmpty, !source.isEmpty {
    expanded.append(.prose(source))
  }
  return expanded
}

private func emptyToNil(_ value: String) -> String? {
  value.isEmpty ? nil : value
}

private func appendProse(_ text: String, into blocks: inout [MarkdownBlock]) {
  let trimmed = text.trimmingCharacters(in: .newlines)
  if trimmed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return }
  blocks.append(.prose(trimmed))
}

/// Blank lines become separate chat paragraphs. SwiftUI `Text` of a markdown
/// `AttributedString` otherwise collapses them into one run-on blob.
public func splitProseParagraphs(_ text: String) -> [String] {
  let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
  return normalized
    .components(separatedBy: "\n\n")
    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
    .filter { !$0.isEmpty }
}

/// Lists, headings, and quotes need full markdown block parse. Ordinary chat
/// prose should keep single newlines instead of turning them into spaces.
public func proseUsesBlockMarkdown(_ text: String) -> Bool {
  for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
    let line = raw.trimmingCharacters(in: .whitespaces)
    if line.hasPrefix("#") { return true }
    if line.hasPrefix("> ") || line == ">" { return true }
    if line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix("+ ") { return true }
    if line.range(of: #"^\d+\.\s"#, options: .regularExpression) != nil { return true }
  }
  return false
}

func extractTableBlocks(_ text: String) -> [MarkdownBlock] {
  if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
    return []
  }
  let lines = text.replacingOccurrences(of: "\r\n", with: "\n")
    .split(separator: "\n", omittingEmptySubsequences: false)
    .map(String.init)
  var blocks: [MarkdownBlock] = []
  var prose: [String] = []
  var index = 0

  func flushProse() {
    appendProse(prose.joined(separator: "\n"), into: &blocks)
    prose.removeAll(keepingCapacity: true)
  }

  while index < lines.count {
    if let parsed = parseGfmTable(lines: lines, start: index) {
      flushProse()
      blocks.append(.table(parsed.table))
      index = parsed.end
    } else {
      prose.append(lines[index])
      index += 1
    }
  }
  flushProse()
  return blocks
}

private func parseGfmTable(lines: [String], start: Int) -> (table: MarkdownTable, end: Int)? {
  guard start + 1 < lines.count,
        let headers = parseTableCells(lines[start]),
        !headers.isEmpty,
        let separators = parseTableCells(lines[start + 1]),
        !separators.isEmpty,
        separators.allSatisfy(isTableSeparatorCell)
  else {
    return nil
  }
  let width = headers.count
  let alignments = (0..<width).map { index -> MarkdownTableAlignment in
    index < separators.count ? tableAlignment(separators[index]) : .left
  }
  var rows: [[String]] = []
  var end = start + 2
  while end < lines.count {
    let raw = lines[end]
    if raw.trimmingCharacters(in: .whitespaces).isEmpty { break }
    guard let cells = parseTableCells(raw) else { break }
    rows.append(normalizeRow(cells, width: width))
    end += 1
  }
  return (
    MarkdownTable(headers: headers, alignments: alignments, rows: rows),
    end
  )
}

private func parseTableCells(_ line: String) -> [String]? {
  let trimmed = line.trimmingCharacters(in: .whitespaces)
  guard trimmed.contains("|") else { return nil }
  var parts = trimmed.split(separator: "|", omittingEmptySubsequences: false)
    .map { $0.trimmingCharacters(in: .whitespaces) }
  if parts.first == "" { parts.removeFirst() }
  if parts.last == "" { parts.removeLast() }
  return parts.isEmpty ? nil : parts
}

private func isTableSeparatorCell(_ cell: String) -> Bool {
  cell.range(of: #"^:?-{3,}:?$"#, options: .regularExpression) != nil
}

private func tableAlignment(_ cell: String) -> MarkdownTableAlignment {
  let left = cell.hasPrefix(":")
  let right = cell.hasSuffix(":")
  if left && right { return .center }
  if right { return .right }
  return .left
}

private func normalizeRow(_ row: [String], width: Int) -> [String] {
  if row.count == width { return row }
  if row.count > width { return Array(row.prefix(width)) }
  return row + Array(repeating: "", count: width - row.count)
}

func extractStructureBlocks(_ text: String) -> [MarkdownBlock] {
  if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
    return []
  }
  let lines = text.replacingOccurrences(of: "\r\n", with: "\n")
    .split(separator: "\n", omittingEmptySubsequences: false)
    .map(String.init)
  var blocks: [MarkdownBlock] = []
  var prose: [String] = []
  var index = 0

  func flushProse() {
    appendProse(prose.joined(separator: "\n"), into: &blocks)
    prose.removeAll(keepingCapacity: true)
  }

  while index < lines.count {
    if isThematicBreak(lines[index]) {
      flushProse()
      blocks.append(.rule)
      index += 1
    } else if let heading = parseHeading(lines[index]) {
      flushProse()
      blocks.append(.heading(level: heading.level, text: heading.text))
      index += 1
    } else if let quote = parseQuote(lines: lines, start: index) {
      flushProse()
      blocks.append(.quote(quote.text))
      index = quote.end
    } else if let list = parseList(lines: lines, start: index) {
      flushProse()
      blocks.append(.list(ordered: list.ordered, start: list.start, items: list.items))
      index = list.end
    } else {
      prose.append(lines[index])
      index += 1
    }
  }
  flushProse()
  return blocks
}

public func splitStrikethroughSpans(_ text: String) -> [MarkdownSpan] {
  var spans: [MarkdownSpan] = []
  var current = ""
  var struck = false
  var index = text.startIndex
  while index < text.endIndex {
    if text[index...].hasPrefix("~~") {
      if !current.isEmpty {
        spans.append(MarkdownSpan(text: current, struck: struck))
        current = ""
      }
      struck.toggle()
      index = text.index(index, offsetBy: 2)
    } else {
      current.append(text[index])
      index = text.index(after: index)
    }
  }
  if struck {
    current = "~~" + current
    struck = false
  }
  if !current.isEmpty {
    spans.append(MarkdownSpan(text: current, struck: struck))
  }
  return spans
}

private func isThematicBreak(_ line: String) -> Bool {
  let trimmed = line.trimmingCharacters(in: .whitespaces)
  return trimmed.range(of: #"^(\*\*\*+|---+|___+)$"#, options: .regularExpression) != nil
}

private func parseHeading(_ line: String) -> (level: Int, text: String)? {
  let trimmed = line.trimmingCharacters(in: .whitespaces)
  guard let match = trimmed.range(of: #"^(#{1,6})\s+(.+)$"#, options: .regularExpression) else {
    return nil
  }
  _ = match
  var rest = trimmed
  var level = 0
  while rest.first == "#" && level < 6 {
    level += 1
    rest.removeFirst()
  }
  rest = rest.trimmingCharacters(in: .whitespaces)
  while rest.last == "#" {
    rest.removeLast()
  }
  rest = rest.trimmingCharacters(in: .whitespaces)
  guard level > 0, !rest.isEmpty else { return nil }
  return (level, rest)
}

private func isQuoteLine(_ line: String) -> Bool {
  line.range(of: #"^\s{0,3}>"#, options: .regularExpression) != nil
}

private func stripQuotePrefix(_ line: String) -> String {
  guard let range = line.range(of: #"^\s{0,3}> ?"#, options: .regularExpression) else {
    return line
  }
  return String(line[range.upperBound...])
}

private func parseQuote(lines: [String], start: Int) -> (text: String, end: Int)? {
  guard start < lines.count, isQuoteLine(lines[start]) else { return nil }
  var parts: [String] = []
  var end = start
  while end < lines.count {
    let line = lines[end]
    if line.trimmingCharacters(in: .whitespaces).isEmpty {
      if end + 1 < lines.count, isQuoteLine(lines[end + 1]) {
        parts.append("")
        end += 1
        continue
      }
      break
    }
    guard isQuoteLine(line) else { break }
    parts.append(stripQuotePrefix(line))
    end += 1
  }
  let text = parts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
  guard !text.isEmpty else { return nil }
  return (text, end)
}

private struct ParsedListLine {
  var ordered: Bool
  var number: Int
  var item: MarkdownListItem
}

private func parseListLine(_ line: String) -> ParsedListLine? {
  let pattern = #"^(\s{0,3})(?:([-*+])|(\d{1,9})[.)])\s+(.+)$"#
  guard let regex = try? NSRegularExpression(pattern: pattern),
        let match = regex.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)),
        let bodyRange = Range(match.range(at: 4), in: line)
  else {
    return nil
  }
  let ordered = match.range(at: 3).location != NSNotFound
  var number = 1
  if ordered, let numRange = Range(match.range(at: 3), in: line) {
    number = Int(line[numRange]) ?? 1
  }
  var body = String(line[bodyRange])
  var checked: Bool?
  if let task = body.range(of: #"^\[([ xX])\]\s+"#, options: .regularExpression) {
    let mark = body[task].dropFirst().prefix(1)
    checked = mark == "x" || mark == "X"
    body = String(body[task.upperBound...])
  }
  return ParsedListLine(
    ordered: ordered,
    number: number,
    item: MarkdownListItem(text: body, checked: checked)
  )
}

private func parseList(lines: [String], start: Int) -> (ordered: Bool, start: Int, items: [MarkdownListItem], end: Int)? {
  guard let first = parseListLine(lines[start]) else { return nil }
  var items: [MarkdownListItem] = [first.item]
  var end = start + 1
  while end < lines.count {
    let line = lines[end]
    if line.trimmingCharacters(in: .whitespaces).isEmpty {
      if end + 1 < lines.count,
         let next = parseListLine(lines[end + 1]),
         next.ordered == first.ordered {
        end += 1
        continue
      }
      break
    }
    if isThematicBreak(line) || parseHeading(line) != nil || isQuoteLine(line) {
      break
    }
    if let parsed = parseListLine(line), parsed.ordered == first.ordered {
      items.append(parsed.item)
      end += 1
      continue
    }
    let indent = line.prefix(while: { $0 == " " || $0 == "\t" }).count
    if indent >= 2, parseListLine(line) == nil {
      items[items.count - 1].text += "\n" + line.trimmingCharacters(in: .whitespaces)
      end += 1
      continue
    }
    break
  }
  return (first.ordered, first.number, items, end)
}
