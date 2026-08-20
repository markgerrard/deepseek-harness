import Foundation
import XCTest
@testable import DsBotCore

final class ProtocolTypesTests: XCTestCase {
  func testJSONValueEncodingAndDecoding() throws {
    let jsonString = """
    {
      "nullKey": null,
      "boolKey": true,
      "intKey": 42,
      "doubleKey": 3.14,
      "strKey": "hello",
      "arrKey": [1, "two", false],
      "objKey": {"nested": "value"}
    }
    """
    let data = try XCTUnwrap(jsonString.data(using: .utf8))
    let decoded = try JSONDecoder().decode([String: JSONValue].self, from: data)

    XCTAssertEqual(decoded["nullKey"], .null)
    XCTAssertEqual(decoded["boolKey"], .bool(true))
    XCTAssertEqual(decoded["intKey"], .number(42))
    XCTAssertEqual(decoded["doubleKey"], .number(3.14))
    XCTAssertEqual(decoded["strKey"], .string("hello"))
    XCTAssertEqual(decoded["arrKey"], .array([.number(1), .string("two"), .bool(false)]))
    XCTAssertEqual(decoded["objKey"], .object(["nested": .string("value")]))

    let reEncoded = try JSONEncoder().encode(decoded)
    let reDecoded = try JSONDecoder().decode([String: JSONValue].self, from: reEncoded)
    XCTAssertEqual(decoded, reDecoded)
  }

  func testJSONValueFromAnyKeepsBoolDistinctFromNumber() {
    let value = JSONValue(any: [
      "ok": true,
      "n": 1,
      "event": [
        "type": "assistant/message",
        "seq": 57,
        "data": ["message": ["content": [["type": "text", "text": "hi"]]]],
      ],
    ] as [String: Any])
    guard case .object(let obj) = value else {
      return XCTFail("expected object")
    }
    XCTAssertEqual(obj["ok"], .bool(true))
    XCTAssertEqual(obj["n"], .number(1))
    XCTAssertEqual(obj["event"]?["type"]?.stringValue, "assistant/message")
    XCTAssertEqual(obj["event"]?["seq"]?.intValue, 57)
    XCTAssertEqual(
      obj["event"]?["data"]?["message"]?["content"]?[0]?["text"]?.stringValue,
      "hi"
    )
  }

  func testSessionEventNotificationDecoding() throws {
    let jsonString = """
    {
      "sessionId": "s1",
      "event": {
        "type": "turn_start",
        "turn": 1
      }
    }
    """
    let data = try XCTUnwrap(jsonString.data(using: .utf8))
    let notification = try JSONDecoder().decode(SessionEventNotification.self, from: data)
    XCTAssertEqual(notification.sessionId, "s1")
    XCTAssertEqual(notification.event["type"], .string("turn_start"))
    XCTAssertEqual(notification.event["turn"], .number(1))
  }

  func testPresetListItemDecoding() throws {
    let jsonString = """
    {
      "id": "code",
      "trust": "system",
      "name": "Coding Bot",
      "description": "Writes code"
    }
    """
    let data = try XCTUnwrap(jsonString.data(using: .utf8))
    let item = try JSONDecoder().decode(PresetListItem.self, from: data)
    XCTAssertEqual(item.id, "code")
    XCTAssertEqual(item.trust, "system")
    XCTAssertEqual(item.name, "Coding Bot")
    XCTAssertEqual(item.description, "Writes code")
    XCTAssertNil(item.broken)
  }

  func testHarnessRPCError() {
    let error = HarnessRPCError(code: -32601, message: "method not found")
    XCTAssertEqual(error.code, -32601)
    XCTAssertEqual(error.message, "method not found")
    XCTAssertEqual(error.errorDescription, "RPC error -32601: method not found")
  }
}
