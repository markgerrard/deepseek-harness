import Foundation

public enum SdkPermissionOutcome: String, Codable, Equatable, Sendable {
  case allowedOnce = "allowed-once"
  case rejected
  case cancelled
  case unavailable
}

public func outcomeForDismissedSheet() -> SdkPermissionOutcome { .rejected }
