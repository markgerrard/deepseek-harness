import Foundation

func record(envVar: String, content: String) {
  guard let recordPath = ProcessInfo.processInfo.environment[envVar] else { return }
  let fileURL = URL(fileURLWithPath: recordPath)
  if let fileHandle = try? FileHandle(forWritingTo: fileURL) {
    defer { try? fileHandle.close() }
    fileHandle.seekToEndOfFile()
    fileHandle.write(Data((content + "\n").utf8))
  } else {
    try? (content + "\n").write(to: fileURL, atomically: true, encoding: .utf8)
  }
}

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
    record(envVar: "FAKE_RECORD_PERMISSION", content: trimmed)
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
  case "presets/copy":
    record(envVar: "FAKE_RECORD_PRESETS_COPY", content: trimmed)
    response["result"] = [String: Any]()
  case "presets/setPersona":
    record(envVar: "FAKE_RECORD_PRESETS_SET_PERSONA", content: trimmed)
    response["result"] = [String: Any]()
  case "session/resume":
    record(envVar: "FAKE_RECORD_RESUME", content: trimmed)
    if let errorMessage = ProcessInfo.processInfo.environment["FAKE_RESUME_ERROR"], !errorMessage.isEmpty {
      response["error"] = ["code": -32000, "message": errorMessage]
    } else {
      response["result"] = [String: Any]()
    }
  case "session/setModel":
    response["result"] = [String: Any]()
  case "session/cancel":
    record(envVar: "FAKE_RECORD_CANCEL", content: trimmed)
    response["result"] = [String: Any]()
  case "session/prompt":
    record(envVar: "FAKE_RECORD_PROMPT", content: trimmed)
    if let errorMessage = ProcessInfo.processInfo.environment["FAKE_PROMPT_ERROR"], !errorMessage.isEmpty {
      response["error"] = ["code": -32000, "message": errorMessage]
    } else {
      response["result"] = ["messageId": "m1"]
    }
  case "shutdown":
    // FAKE_HANG_SHUTDOWN simulates an unresponsive runtime: no response, no
    // exit — teardown must bound this from the client side.
    if ProcessInfo.processInfo.environment["FAKE_HANG_SHUTDOWN"] == "1" {
      continue
    }
    response["result"] = [String: Any]()
    shouldExit = true
    record(envVar: "FAKE_RECORD_SHUTDOWN", content: "shutdown")
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
