import SwiftUI
import DsBotCore

@main
struct DsBotApp: App {
  @State private var controller: SessionController
  private let runtime: RuntimeProcess?
  private let workspace: URL

  init() {
    let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
    let dsBotDir = appSupport.appendingPathComponent("DsBot", isDirectory: true)
    try? FileManager.default.createDirectory(at: dsBotDir, withIntermediateDirectories: true)
    let storeURL = dsBotDir.appendingPathComponent("bots.json")
    let store = BotStore(fileURL: storeURL)
    let workspace = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
    self.workspace = workspace
    let repo = RuntimeLaunch.findRepoRoot() ?? URL(fileURLWithPath: "/Volumes/Workspace/repos/dsbot")
    let node = FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/node")
      ? "/opt/homebrew/bin/node"
      : "node"
    let launch = RuntimeLaunch.macosProfile(repoRoot: repo, workspace: workspace, node: node)
    let runtime = RuntimeProcess(launch: launch)
    let client: HarnessClient
    do {
      client = try runtime.start()
      self.runtime = runtime
    } catch {
      self.runtime = nil
      client = HarnessClient(command: launch.command, arguments: launch.arguments, cwd: launch.cwd)
    }
    _controller = State(initialValue: SessionController(client: client, store: store))
  }

  var body: some Scene {
    WindowGroup {
      RootView(controller: controller)
        .task {
          try? await controller.initialize(
            cwd: workspace.path,
            provider: "cline-pass",
            model: "cline-pass/deepseek-v4-flash",
            approvals: true
          )
        }
    }
  }
}
