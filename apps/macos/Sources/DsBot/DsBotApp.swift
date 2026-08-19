import SwiftUI
import DsBotCore

@main
struct DsBotApp: App {
  @State private var controller: SessionController

  init() {
    let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
    let dsBotDir = appSupport.appendingPathComponent("DsBot", isDirectory: true)
    try? FileManager.default.createDirectory(at: dsBotDir, withIntermediateDirectories: true)
    let storeURL = dsBotDir.appendingPathComponent("bots.json")
    let store = BotStore(fileURL: storeURL)
    let cwd = FileManager.default.homeDirectoryForCurrentUser
    let launch = RuntimeLaunch.macosProfile(repoRoot: URL(fileURLWithPath: "."), workspace: cwd)
    let client = HarnessClient(command: launch.command, arguments: launch.arguments, cwd: launch.cwd, environment: launch.environment)
    let ctrl = SessionController(client: client, store: store)
    _controller = State(initialValue: ctrl)
  }

  var body: some Scene {
    WindowGroup {
      RootView(controller: controller)
    }
  }
}
