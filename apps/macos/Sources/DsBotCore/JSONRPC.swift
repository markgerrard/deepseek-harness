import Foundation

public struct JSONRPCRequest<Params: Encodable & Sendable>: Encodable, Sendable {
  public var jsonrpc: String = "2.0"
  public var id: Int
  public var method: String
  public var params: Params

  public init(id: Int, method: String, params: Params) {
    self.id = id
    self.method = method
    self.params = params
  }
}

public struct JSONRPCNotification<Params: Encodable & Sendable>: Encodable, Sendable {
  public var jsonrpc: String = "2.0"
  public var method: String
  public var params: Params

  public init(method: String, params: Params) {
    self.method = method
    self.params = params
  }
}

public struct JSONRPCErrorPayload: Codable, Equatable, Sendable {
  public var code: Int
  public var message: String
  public var data: JSONValue?

  public init(code: Int, message: String, data: JSONValue? = nil) {
    self.code = code
    self.message = message
    self.data = data
  }
}

public struct JSONRPCResponse<Result: Encodable & Sendable>: Encodable, Sendable {
  public var jsonrpc: String = "2.0"
  public var id: JSONValue
  public var result: Result

  public init(id: JSONValue, result: Result) {
    self.id = id
    self.result = result
  }
}

public struct JSONRPCErrorResponse: Encodable, Sendable {
  public var jsonrpc: String = "2.0"
  public var id: JSONValue
  public var error: JSONRPCErrorPayload

  public init(id: JSONValue, error: JSONRPCErrorPayload) {
    self.id = id
    self.error = error
  }
}


public enum JSONRPCCodec {
  public static func encodeRequest<Params: Encodable & Sendable>(
    id: Int,
    method: String,
    params: Params
  ) throws -> Data {
    let message = JSONRPCRequest(id: id, method: method, params: params)
    let encoder = JSONEncoder()
    var data = try encoder.encode(message)
    data.append(0x0A) // \n
    return data
  }

  public static func encodeNotification<Params: Encodable & Sendable>(
    method: String,
    params: Params
  ) throws -> Data {
    let message = JSONRPCNotification(method: method, params: params)
    let encoder = JSONEncoder()
    var data = try encoder.encode(message)
    data.append(0x0A) // \n
    return data
  }
}
