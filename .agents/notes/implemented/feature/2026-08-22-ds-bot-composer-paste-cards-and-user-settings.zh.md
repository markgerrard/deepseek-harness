# Agent Note：DS Bot 输入区、粘贴卡片、正文选择与用户设置

Status: implemented

[English](2026-08-22-ds-bot-composer-paste-cards-and-user-settings.md) | 中文

## 问题

聊天输入无法支持三个需求：超过阈值的粘贴要变成可移除的卡片（claude.ai 风格）而非把数千字符灌入输入框；Return 与 Shift+Return 需要 发送/换行 语义；输入要随草稿增长——静止时是控件内联的单行胶囊，多行后长成控件落到底部行的高卡片。另外：助手回复中的文本选择在段落间隙处中断；侧栏不显示 bot 头衔；没有用户身份——无资料页脚，账户设置面板是孤立的。

## 决策

输入区是包着 `NSTextView` 的 `NSViewRepresentable`（`ComposerTextView`）：keydown 把裸 Return 路由到发送、Shift+Return 到换行；`paste:`/`pasteAsPlainText:` 把超过 `AttachmentStore.pasteChipCharacterLimit`（1,200 字符）的粘贴路由成卡片；delegate 发布排版后的内容高度，SwiftUI 持有 frame 决策（上限 220pt）。容器在 胶囊（≤34pt）/ 卡片 两态间插值同一个 `RoundedRectangle` 的圆角，因此形变可动画。粘贴卡片是固定 120×110 的摘录缩略卡，横向排在输入区内；发送时经 `AttachmentStore.pastedTextSuffix` 以编号围栏并入 wire prompt。已完成的正文块合并为单个 `Text`（段落以显式 `\n\n` 连接），因为 SwiftUI 选择以 Text 实例为界；流式渲染保留逐段布局以控制成本。侧栏行以可截断 chip 展示 `Bot.title`，时间戳定宽居右；用户页脚读取持久化的 `userName`（默认 "Mark"，空白回退），向上弹出菜单，唯一入口打开带标签页的 `UserSettingsSheet`（General / Providers / API keys）。

## 曾考虑的替代方案

**SwiftUI `TextField(axis:)` + `onPasteCommand`。** 拒绝：文本视图持有焦点时 ⌘V 被 AppKit 消费，该回调根本不触发；拦截粘贴必须自己拥有 `NSTextView`。**逐段可选 `Text` + 跨视图拖选。** 无法表达：选择不能离开 Text 实例——故整块合并。**用 Menu 承载 attach/settings 弹出。** 两次否决：AppKit 菜单项渲染会丢弃 label 装饰（加号圆环消失）且位置不可控；均改为 Button + 显式 `arrowEdge` 的 popover。

## 后果

**换来**：一个 owner 同时满足三项输入行为；已完成回复跨段可选；bot 头衔可见；真实用户身份驱动头像首字母。**付出**：IME 边缘情形走自定义按键处理；占位符对齐依赖清零的 `lineFragmentPadding`；完成回复中代码围栏仍是选择边界；侧栏头衔 chip 只截断、不挤占名称列。

## 测试

单元测试：粘贴阈值边界、后缀拼装、`userName` 默认值/持久化/空白回退（DsBotCoreTests）。视图接线（按键、粘贴路由、生长、弹出方向）按惯例在运行中的应用里验证。
