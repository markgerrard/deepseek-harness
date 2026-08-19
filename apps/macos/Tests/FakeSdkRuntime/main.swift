import Foundation

while let line = readLine() {
  let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
  if trimmed.isEmpty { continue }
  guard let data = trimmed.data(using: .utf8),
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
    continue
  }
  guard let id = json["id"] else {
    // Ignore notifications (no id)
    continue
  }

  // Handle client responses (frame with id but no method)
  if json["method"] == nil {
    if let recordPath = ProcessInfo.processInfo.environment["FAKE_RECORD_PERMISSION"] {
      let fileURL = URL(fileURLWithPath: recordPath)
      if let fileHandle = try? FileHandle(forWritingTo: fileURL) {
        defer { try? fileHandle.close() }
        fileHandle.seekToEndOfFile()
        fileHandle.write(Data((trimmed + "\n").utf8))
      } else {
        try? (trimmed + "\n").write(to: fileURL, atomically: true, encoding: .utf8)
      }
    }
    continue
  }

  guard let method = json["method"] as? String else {
    continue
  }

  var response: [String: Any] = [
    "jsonrpc": "2.0",
    "id": id,
  ]

  var shouldExit = false
  var shouldAskPermission = false

  switch method {
  case "initialize":
    response["result"] = ["serverInfo": ["name": "deepseek-harness-sdk-runtime", "version": "0.0.1"]]
    if ProcessInfo.processInfo.environment["FAKE_ASK_PERMISSION"] == "1" {
      shouldAskPermission = true
    }
  case "presets/list":
    response["result"] = ["presets": [["id": "code", "trust": "system"]]]
  case "presets/copy", "presets/setPersona", "session/resume", "session/setModel", "session/cancel":
    response["result"] = [String: Any]()
  case "session/prompt":
    response["result"] = ["messageId": "m1"]
  case "shutdown":
    response["result"] = [String: Any]()
    shouldExit = true
    if let recordPath = ProcessInfo.processInfo.environment["FAKE_RECORD_SHUTDOWN"] {
      let fileURL = URL(fileURLWithPath: recordPath)
      if let fileHandle = try? FileHandle(forWritingTo: fileURL) {
        defer { try? fileHandle.close() }
        fileHandle.seekToEndOfFile()
        fileHandle.write(Data("shutdown\n".utf8))
      } else {
        try? "shutdown\n".write(to: fileURL, atomically: true, encoding: .utf8)
      }
    }
  default:
    response["error"] = ["code": -32601, "message": "method not found"]
  }

  if let respData = try? JSONSerialization.data(withJSONObject: response),
     let respString = String(data: respData, encoding: .utf8) {
    FileHandle.standardOutput.write(Data((respString + "\n").utf8))
  }

  if shouldAskPermission {
    let permRequest: [String: Any] = [
      "jsonrpc": "2.0",
      "id": "perm-1",
      "method": "session/request_permission",
      "params": [
        "sessionId": "main",
        "toolName": "bash",
        "callId": "call-1",
        "reason": "escalate sandbox"
      ]
    ]
    if let permData = try? JSONSerialization.data(withJSONObject: permRequest),
       let permString = String(data: permData, encoding: .utf8) {
      FileHandle.standardOutput.write(Data((permString + "\n").utf8))
    }
  }

  if shouldExit {
    exit(0)
  }
}
