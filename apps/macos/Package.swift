// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "DsBot",
  platforms: [
    .macOS(.v15)
  ],
  products: [
    .library(name: "DsBotCore", targets: ["DsBotCore"]),
    .executable(name: "DsBot", targets: ["DsBot"]),
  ],
  dependencies: [],
  targets: [
    .target(
      name: "DsBotCore",
      dependencies: []
    ),
    .executableTarget(
      name: "DsBot",
      dependencies: ["DsBotCore"],
      resources: [.process("Resources")]
    ),
    .executableTarget(
      name: "FakeSdkRuntime",
      path: "Tests/FakeSdkRuntime"
    ),
    .testTarget(
      name: "DsBotCoreTests",
      dependencies: ["DsBotCore"]
    ),
  ]
)
