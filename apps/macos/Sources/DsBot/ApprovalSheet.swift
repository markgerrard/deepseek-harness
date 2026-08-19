import SwiftUI
import DsBotCore

public struct ApprovalSheet: View {
  let request: PermissionRequest
  let onResolve: (SdkPermissionOutcome) -> Void

  public init(request: PermissionRequest, onResolve: @escaping (SdkPermissionOutcome) -> Void) {
    self.request = request
    self.onResolve = onResolve
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        Image(systemName: "exclamationmark.shield")
          .font(.system(size: 28))
          .foregroundColor(.orange)
        VStack(alignment: .leading, spacing: 2) {
          Text("Permission Request")
            .font(.headline)
          Text("A tool requires approval to execute.")
            .font(.subheadline)
            .foregroundColor(.secondary)
        }
      }

      Divider()

      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Text("Tool:")
            .fontWeight(.semibold)
            .frame(width: 80, alignment: .leading)
          Text(request.toolName)
            .font(.system(.body, design: .monospaced))
        }

        HStack {
          Text("Session:")
            .fontWeight(.semibold)
            .frame(width: 80, alignment: .leading)
          Text(request.sessionId)
            .font(.system(.caption, design: .monospaced))
            .foregroundColor(.secondary)
        }

        if let reason = request.reason, !reason.isEmpty {
          HStack(alignment: .top) {
            Text("Reason:")
              .fontWeight(.semibold)
              .frame(width: 80, alignment: .leading)
            Text(reason)
          }
        }
      }
      .padding()
      .background(Color(nsColor: .controlBackgroundColor))
      .cornerRadius(8)

      Divider()

      HStack {
        Button("Cancel") {
          onResolve(.cancelled)
        }

        Spacer()

        Button("Reject") {
          onResolve(outcomeForDismissedSheet())
        }
        .keyboardShortcut(.cancelAction)

        Button("Allow Once") {
          onResolve(.allowedOnce)
        }
        .buttonStyle(.borderedProminent)
        .keyboardShortcut(.defaultAction)
      }
    }
    .padding(20)
    .frame(minWidth: 420, maxWidth: 500)
  }
}
