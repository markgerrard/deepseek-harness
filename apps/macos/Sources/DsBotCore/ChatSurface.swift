import Foundation

public enum ChatSurface: String, Codable, Equatable, Sendable, Hashable, CaseIterable {
  case simple
  case advanced
}

public struct PresentedChat: Equatable, Sendable {
  public var items: [TranscriptItem]
  public var isWorking: Bool
  public var activityLabel: String?
  /// Older items exist beyond the presented window; scroll-back loads them.
  public var hasEarlier: Bool

  public init(items: [TranscriptItem], isWorking: Bool, activityLabel: String? = nil, hasEarlier: Bool = false) {
    self.items = items
    self.isWorking = isWorking
    self.activityLabel = activityLabel
    self.hasEarlier = hasEarlier
  }
}

public func resolvedChatSurface(
  account: ChatSurface,
  bot: ChatSurface?,
  session: ChatSurface?
) -> ChatSurface {
  session ?? bot ?? account
}

public func presentChat(items: [TranscriptItem], surface: ChatSurface) -> PresentedChat {
  let isWorking = items.contains(where: isInFlight)
  let label = isWorking ? chatActivityLabel(for: items) : nil
  switch surface {
  case .advanced:
    return PresentedChat(items: items, isWorking: isWorking, activityLabel: label)
  case .simple:
    return PresentedChat(items: items.compactMap(simpleItem), isWorking: isWorking, activityLabel: label)
  }
}

public func chatActivityLabel(for items: [TranscriptItem]) -> String? {
  for item in items.reversed() {
    switch item {
    case .tool(_, _, _, let name, _, _, let status, _, _) where status == .running || status == .awaiting:
      return humanizeToolActivity(name)
    case .workflow(_, _, _, _, .running, _, _):
      return "Working"
    default:
      continue
    }
  }
  return nil
}

public func humanizeToolActivity(_ name: String) -> String {
  let n = name.lowercased()
  if n.contains("web") || n.contains("fetch") { return "Searching the web" }
  if n.contains("bash") || n.contains("shell") || n.contains("exec") || n.contains("command") {
    return "Running a command"
  }
  if n.contains("read") { return "Reading" }
  if n.contains("write") || n.contains("edit") || n.contains("replace") || n.contains("patch") {
    return "Editing"
  }
  if n.contains("grep") || n.contains("glob") || n.contains("search") { return "Searching files" }
  return "Working"
}

private func isInFlight(_ item: TranscriptItem) -> Bool {
  switch item {
  case .tool(_, _, _, _, _, _, let status, _, _) where status == .running || status == .awaiting:
    return true
  case .reasoning(_, _, _, true, _):
    return true
  case .workflow(_, _, _, _, .running, _, _):
    return true
  default:
    return false
  }
}

private func simpleItem(_ item: TranscriptItem) -> TranscriptItem? {
  switch item {
  case .user, .assistant, .artifact:
    return item
  case .tool(let id, let seq, _, let name, let args, _, let status, _, _):
    guard status == .success, isWritingTool(name), let path = artifactPath(fromArgs: args) else {
      return nil
    }
    return .artifact(
      id: "artifact:\(id)",
      seq: seq,
      name: URL(fileURLWithPath: path).lastPathComponent,
      path: path
    )
  default:
    return nil
  }
}

private func isWritingTool(_ name: String) -> Bool {
  let lower = name.lowercased()
  return lower.contains("write")
    || lower.contains("edit")
    || lower.contains("replace")
    || lower.contains("create")
    || lower.contains("patch")
}

private func artifactPath(fromArgs args: String) -> String? {
  guard let data = args.data(using: .utf8),
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
    return nil
  }
  for key in ["path", "file_path", "filePath"] {
    if let value = object[key] as? String {
      let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
      if !trimmed.isEmpty { return trimmed }
    }
  }
  return nil
}
