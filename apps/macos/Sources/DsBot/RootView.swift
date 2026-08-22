import SwiftUI
import DsBotCore

public struct RootView: View {
  @Bindable var controller: SessionController
  @State private var isCreateBotPresented = false
  @State private var isBotSettingsPresented = false
  @State private var isAccountSettingsPresented = false

  public init(controller: SessionController) {
    self.controller = controller
  }

  public var body: some View {
    HStack(spacing: 0) {
      SidebarView(
        controller: controller,
        isCreateBotPresented: $isCreateBotPresented,
        isBotSettingsPresented: $isBotSettingsPresented,
        isAccountSettingsPresented: $isAccountSettingsPresented
      )
      .frame(width: 268)
      .frame(maxHeight: .infinity)

      paneRule

      ChatView(controller: controller, isBotSettingsPresented: $isBotSettingsPresented)
        .frame(maxWidth: .infinity, maxHeight: .infinity)

      if isBotSettingsPresented {
        paneRule
        Group {
          if let botId = controller.selectedBotId {
            BotSettingsInspector(
              controller: controller,
              botId: botId,
              onClose: { isBotSettingsPresented = false }
            )
          } else {
            VStack {
              Spacer()
              Text("Select a bot")
                .foregroundStyle(.secondary)
              Spacer()
            }
          }
        }
        .frame(width: 320)
        .frame(maxHeight: .infinity)
      }
    }
    .preferredColorScheme(.dark)
    .frame(minWidth: 720, minHeight: 480)
    .background(Color.black.opacity(0.92))
    .background(TitlebarSpace())
    .ignoresSafeArea(edges: .top)
    .safeAreaInset(edge: .top, spacing: 0) {
      if let initError = controller.initializationError {
        HStack(spacing: 8) {
          Image(systemName: "exclamationmark.triangle.fill")
            .foregroundStyle(.yellow)
          Text(initError)
            .font(.callout)
            .foregroundStyle(.red)
          Spacer()
        }
        .padding(10)
        .background(Color.red.opacity(0.12))
      }
    }
    .sheet(isPresented: $isCreateBotPresented) {
      CreateBotSheet(
        controller: controller,
        isPresented: $isCreateBotPresented,
        onCreated: { isBotSettingsPresented = true }
      )
    }
    .sheet(isPresented: $isAccountSettingsPresented) {
      UserSettingsSheet(controller: controller, isPresented: $isAccountSettingsPresented)
    }
    .sheet(item: Binding(
      get: { controller.pendingApproval },
      set: { if $0 == nil { controller.dismissPendingApproval() } }
    )) { req in
      ApprovalSheet(request: req) { outcome in
        controller.respondToPendingApproval(with: outcome)
      }
    }
  }

  private var paneRule: some View {
    Rectangle()
      .fill(Color.white.opacity(0.08))
      .frame(width: 1)
      .frame(maxHeight: .infinity)
  }
}
