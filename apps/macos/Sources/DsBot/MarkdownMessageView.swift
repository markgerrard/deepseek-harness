import AppKit
import SwiftUI
import DsBotCore

struct MarkdownMessageView: View, Equatable {
  var source: String

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      ForEach(Array(splitMarkdownBlocks(source).enumerated()), id: \.offset) { _, block in
        switch block {
        case .prose(let markdown):
          proseView(markdown)
        case .code(let language, let code):
          codeView(language: language, source: code)
        case .table(let table):
          tableView(table)
        case .heading(let level, let text):
          headingView(level: level, text: text)
        case .quote(let text):
          quoteView(text)
        case .list(let ordered, let start, let items):
          listView(ordered: ordered, start: start, items: items)
        case .rule:
          Rectangle()
            .fill(Color.secondary.opacity(0.35))
            .frame(height: 1)
            .padding(.vertical, 6)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder
  private func proseView(_ markdown: String) -> some View {
    let paragraphs = splitProseParagraphs(markdown)
    VStack(alignment: .leading, spacing: 10) {
      ForEach(Array(paragraphs.enumerated()), id: \.offset) { _, paragraph in
        Text(styledProse(paragraph))
          .lineSpacing(3)
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }

  private func codeView(language: String?, source: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      if let language, !language.isEmpty {
        Text(language)
          .font(.caption2.monospaced())
          .foregroundStyle(.secondary)
      }
      ScrollView(.horizontal, showsIndicators: false) {
        Text(source)
          .font(.system(.callout, design: .monospaced))
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .padding(10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color(nsColor: .textBackgroundColor))
    .clipShape(RoundedRectangle(cornerRadius: 6))
    .overlay(
      RoundedRectangle(cornerRadius: 6)
        .stroke(Color.secondary.opacity(0.2))
    )
  }

  private func tableView(_ table: MarkdownTable) -> some View {
    let width = table.headers.count
    return ScrollView(.horizontal, showsIndicators: true) {
      Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
        GridRow {
          ForEach(0..<width, id: \.self) { column in
            tableCell(
              table.headers[column],
              alignment: table.alignment(at: column),
              header: true
            )
          }
        }
        ForEach(Array(table.rows.enumerated()), id: \.offset) { _, row in
          GridRow {
            ForEach(0..<width, id: \.self) { column in
              tableCell(
                column < row.count ? row[column] : "",
                alignment: table.alignment(at: column),
                header: false
              )
            }
          }
        }
      }
    }
    .clipShape(RoundedRectangle(cornerRadius: 8))
    .overlay(
      RoundedRectangle(cornerRadius: 8)
        .stroke(Color.secondary.opacity(0.25))
    )
  }

  private func tableCell(_ markdown: String, alignment: MarkdownTableAlignment, header: Bool) -> some View {
    let frameAlignment: Alignment = {
      switch alignment {
      case .left: return .leading
      case .center: return .center
      case .right: return .trailing
      }
    }()
    return Text(styledProse(markdown.isEmpty ? " " : markdown))
      .font(header ? .callout.weight(.semibold) : .callout)
      .multilineTextAlignment(alignment == .right ? .trailing : alignment == .center ? .center : .leading)
      .textSelection(.enabled)
      .padding(.horizontal, 10)
      .padding(.vertical, 7)
      .frame(minWidth: 72, maxWidth: .infinity, alignment: frameAlignment)
      .background(header ? Color.white.opacity(0.10) : Color.white.opacity(0.03))
      .overlay(alignment: .bottom) {
        Rectangle()
          .fill(Color.secondary.opacity(0.22))
          .frame(height: 1)
      }
      .overlay(alignment: .trailing) {
        Rectangle()
          .fill(Color.secondary.opacity(0.18))
          .frame(width: 1)
      }
  }

  private func headingView(level: Int, text: String) -> some View {
    let font: Font = {
      switch level {
      case 1: return .title2.weight(.semibold)
      case 2: return .title3.weight(.semibold)
      case 3: return .headline
      default: return .subheadline.weight(.semibold)
      }
    }()
    return Text(styledProse(text))
      .font(font)
      .textSelection(.enabled)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.top, level <= 2 ? 4 : 2)
  }

  private func quoteView(_ text: String) -> some View {
    HStack(alignment: .top, spacing: 10) {
      RoundedRectangle(cornerRadius: 1)
        .fill(Color.secondary.opacity(0.55))
        .frame(width: 3)
      proseView(text)
        .foregroundStyle(.secondary)
    }
    .padding(.vertical, 2)
  }

  private func listView(ordered: Bool, start: Int, items: [MarkdownListItem]) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      ForEach(Array(items.enumerated()), id: \.offset) { index, item in
        HStack(alignment: .top, spacing: 8) {
          listMarker(ordered: ordered, start: start, index: index, checked: item.checked)
          Text(styledProse(item.text))
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
    }
  }

  @ViewBuilder
  private func listMarker(ordered: Bool, start: Int, index: Int, checked: Bool?) -> some View {
    if let checked {
      Image(systemName: checked ? "checkmark.square.fill" : "square")
        .foregroundStyle(checked ? Color.accentColor : Color.secondary)
        .font(.body)
        .padding(.top, 1)
    } else if ordered {
      Text("\(start + index).")
        .foregroundStyle(.secondary)
        .font(.callout.monospacedDigit())
        .frame(minWidth: 20, alignment: .trailing)
        .padding(.top, 1)
    } else {
      Text("•")
        .foregroundStyle(.secondary)
        .frame(minWidth: 12, alignment: .center)
        .padding(.top, 1)
    }
  }

  private func styledProse(_ markdown: String) -> AttributedString {
    var combined = AttributedString()
    let spans = splitStrikethroughSpans(markdown)
    let pieces = spans.isEmpty ? [MarkdownSpan(text: markdown, struck: false)] : spans
    for span in pieces {
      var attr = parseInlineMarkdown(span.text)
      if span.struck {
        attr.strikethroughStyle = .single
        attr.foregroundColor = Color.secondary
      }
      combined += attr
    }
    return combined
  }

  private func parseInlineMarkdown(_ markdown: String) -> AttributedString {
    let options = AttributedString.MarkdownParsingOptions(
      interpretedSyntax: .inlineOnlyPreservingWhitespace,
      failurePolicy: .returnPartiallyParsedIfPossible
    )
    var attr = (try? AttributedString(markdown: markdown, options: options)) ?? AttributedString(markdown)
    for run in attr.runs {
      let range = run.range
      if run.inlinePresentationIntent?.contains(.code) == true {
        attr[range].font = .system(.body, design: .monospaced)
        attr[range].backgroundColor = Color.primary.opacity(0.08)
      }
      if run.link != nil {
        attr[range].foregroundColor = Color.accentColor
        attr[range].underlineStyle = .single
      }
    }
    return attr
  }
}
