import SwiftUI
import DsBotCore

public struct RootView: View {
  @Bindable var controller: SessionController
  @State private var isCreateBotPresented = false
  @State private var editingBot: Bot?
  @State private var isAccountSettingsPresented = false

  public init(controller: SessionController) {
    self.controller = controller
  }

  public var body: some View {
    NavigationSplitView {
      SidebarView(
        controller: controller,
        isCreateBotPresented: $isCreateBotPresented,
        editingBot: $editingBot,
        isAccountSettingsPresented: $isAccountSettingsPresented
      )
        .navigationSplitViewColumnWidth(min: 220, ideal: 268, max: 340)
    } detail: {
      ChatView(controller: controller)
    }
    .preferredColorScheme(.dark)
    .frame(minWidth: 720, minHeight: 480)
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
      CreateBotSheet(controller: controller, isPresented: $isCreateBotPresented)
    }
    .sheet(isPresented: $isAccountSettingsPresented) {
      AccountSettingsSheet(isPresented: $isAccountSettingsPresented)
    }
    .sheet(item: $editingBot) { bot in
      CreateBotSheet(
        controller: controller,
        editingBot: bot,
        isPresented: Binding(
          get: { true },
          set: { if !$0 { editingBot = nil } }
        )
      )
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
}
