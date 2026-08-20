import AppKit
import SwiftUI
import DsBotCore

final class DsBotAppDelegate: NSObject, NSApplicationDelegate {
  var runtime: RuntimeProcess?

  func applicationDidFinishLaunching(_ notification: Notification) {
    // `swift run` starts a unix executable, not a bundled .app. Without a
    // regular activation policy the window can appear while key events stay
    // on Terminal.
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
  }

  func applicationDidBecomeActive(_ notification: Notification) {
    NSApp.activate(ignoringOtherApps: true)
  }

  func applicationWillTerminate(_ notification: Notification) {
    let sem = DispatchSemaphore(value: 0)
    Task {
      try? await runtime?.stop()
      sem.signal()
    }
    _ = sem.wait(timeout: .now() + 4)
  }
}

@main
struct DsBotApp: App {
  @NSApplicationDelegateAdaptor(DsBotAppDelegate.self) private var appDelegate
  @State private var controller: SessionController
  private let runtime: RuntimeProcess?
  private let workspace: URL

  init() {
    let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
    let dsBotDir = appSupport.appendingPathComponent("DsBot", isDirectory: true)
    let workspace = dsBotDir.appendingPathComponent("workspace", isDirectory: true)
    try? FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
    let storeURL = dsBotDir.appendingPathComponent("bots.json")
    let store = BotStore(fileURL: storeURL)
    self.workspace = workspace
    let repo = RuntimeLaunch.findRepoRoot()
      ?? ProcessInfo.processInfo.environment["DSH_REPO"].flatMap { URL(fileURLWithPath: $0) }
      ?? URL(fileURLWithPath: "/Volumes/Workspace/repos/dsbot")
    let node = FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/node")
      ? "/opt/homebrew/bin/node"
      : "node"
    let launch = RuntimeLaunch.macosProfile(
      repoRoot: repo,
      workspace: workspace,
      node: node,
      environment: LaunchCredentials.childEnvironment()
    )
    let runtime = RuntimeProcess(launch: launch)
    let client: HarnessClient
    do {
      client = try runtime.start()
      self.runtime = runtime
    } catch {
      self.runtime = nil
      client = HarnessClient(
        command: launch.command,
        arguments: launch.arguments,
        cwd: launch.cwd,
        environment: launch.environment
      )
    }
    _controller = State(initialValue: SessionController(client: client, store: store))
  }

  var body: some Scene {
    WindowGroup {
      RootView(controller: controller)
        .preferredColorScheme(.dark)
        .onAppear {
          appDelegate.runtime = runtime
          NSApp.activate(ignoringOtherApps: true)
        }
        .task {
          do {
            try await controller.initialize(
              cwd: workspace.path,
              provider: "cline-pass",
              model: "cline-pass/deepseek-v4-flash",
              approvals: true
            )
          } catch {
            // initializationError is already recorded on the controller
          }
        }
    }
  }
}
