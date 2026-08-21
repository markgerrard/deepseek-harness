import Foundation

/// Prefer the transcript write time when it is later than thread creation.
public func lastActivityDate(threadCreatedAt: Date, transcriptModifiedAt: Date?) -> Date {
  guard let transcriptModifiedAt else { return threadCreatedAt }
  return max(threadCreatedAt, transcriptModifiedAt)
}

public func relativeActivityStamp(
  from date: Date,
  now: Date = Date(),
  calendar: Calendar = .current
) -> String {
  if calendar.isDate(date, inSameDayAs: now) {
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.timeZone = calendar.timeZone
    formatter.dateStyle = .none
    formatter.timeStyle = .short
    return formatter.string(from: date)
  }
  if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
     calendar.isDate(date, inSameDayAs: yesterday) {
    return "Yesterday"
  }
  if let weekAgo = calendar.date(byAdding: .day, value: -6, to: now), date >= weekAgo {
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = "EEEE"
    return formatter.string(from: date)
  }
  let formatter = DateFormatter()
  formatter.calendar = calendar
  formatter.timeZone = calendar.timeZone
  formatter.dateFormat = "dd/MM"
  return formatter.string(from: date)
}
