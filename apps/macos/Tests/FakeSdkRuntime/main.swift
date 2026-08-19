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
  guard let method = json["method"] as? String else {
    continue
  }

  var response: [String: Any] = [
    "jsonrpc": "2.0",
    "id": id,
  ]

  var shouldExit = false
  switch method {
  case "initialize":
    response["result"] = ["serverInfo": ["name": "deepseek-harness-sdk-runtime", "version": "0.0.1"]]
  case "presets/list":
    response["result"] = ["presets": [["id": "code", "trust": "system"]]]
  case "presets/copy", "presets/setPersona", "session/resume", "session/setModel", "session/cancel":
    response["result"] = [String: Any]()
  case "session/prompt":
    response["result"] = ["messageId": "m1"]
  case "shutdown":
    response["result"] = [String: Any]()
    shouldExit = true
  default:
    response["error"] = ["code": -32601, "message": "method not found"]
  }

  if let respData = try? JSONSerialization.data(withJSONObject: response),
     let respString = String(data: respData, encoding: .utf8) {
    FileHandle.standardOutput.write(Data((respString + "\n").utf8))
  }

  if shouldExit {
    exit(0)
  }
}
