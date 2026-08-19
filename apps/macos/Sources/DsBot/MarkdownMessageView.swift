import AppKit
import SwiftUI
import DsBotCore

struct MarkdownMessageView: View {
  var source: String

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      ForEach(Array(splitMarkdownBlocks(source).enumerated()), id: \.offset) { _, block in
        switch block {
        case .prose(let markdown):
          proseView(markdown)
        case .code(let language, let code):
          codeView(language: language, source: code)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder
  private func proseView(_ markdown: String) -> some View {
    Text(styledProse(markdown))
      .textSelection(.enabled)
      .frame(maxWidth: .infinity, alignment: .leading)
      .fixedSize(horizontal: false, vertical: true)
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

  private func styledProse(_ markdown: String) -> AttributedString {
    let options = AttributedString.MarkdownParsingOptions(
      interpretedSyntax: .full,
      failurePolicy: .returnPartiallyParsedIfPossible
    )
    var attr = (try? AttributedString(markdown: markdown, options: options)) ?? AttributedString(markdown)
    for run in attr.runs {
      let range = run.range
      if let intent = run.presentationIntent {
        for component in intent.components {
          switch component.kind {
          case .header(let level):
            switch level {
            case 1: attr[range].font = .title2.weight(.semibold)
            case 2: attr[range].font = .title3.weight(.semibold)
            case 3: attr[range].font = .headline
            default: attr[range].font = .subheadline.weight(.semibold)
            }
          default:
            break
          }
        }
      }
      if run.inlinePresentationIntent?.contains(.code) == true {
        attr[range].font = .system(.body, design: .monospaced)
        attr[range].backgroundColor = Color.primary.opacity(0.08)
      }
    }
    return attr
  }
}
