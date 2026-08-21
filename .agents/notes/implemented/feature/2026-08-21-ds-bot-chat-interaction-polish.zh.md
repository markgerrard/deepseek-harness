# Agent Note: DS Bot 拖动区域、悬停消息操作与流式渲染成本

Status: implemented

[English](2026-08-21-ds-bot-chat-interaction-polish.md) | 中文

## Problem

聊天界面的三个缺陷：在短消息里拖动选择文本会移动窗口，因为窗口开启了背景拖动且根视图背后垫着窗口拖动层；消息没有复制入口；数千词的流式回复即使在固定 10Hz 渲染合并下也会卡死主线程，因为对整个增长气泡做一次 markdown 重排就超过了间隔本身。

## Decision

关闭 `isMovableByWindowBackground` 并移除根级 `WindowDragArea`：拖动只属于显式的 40pt 头部条（侧栏、聊天、检查器）。消息行跟踪指针悬停并展示 Grok Bot 风格的操作行——带对勾确认的复制按钮加省略号菜单——bot 气泡在右侧、用户气泡在左侧，空闲时以透明度隐藏，展示不会引起回流。流式气泡渲染纯可选文本，消息定稿后才切换到完整 markdown；渲染合并间隔随投影器缓冲的流长度缩放：4k 字符内 100ms，12k 内 250ms，之后 500ms。

## Alternatives considered

**只对追加尾部做增量 markdown 排版。** 暂否决：SwiftUI 的 Text/AttributedString 没有稳定的追加接缝；流式纯文本加定稿时 markdown 无需自制排版引擎即可达到成本上界。

**用固定的更慢间隔代替缩放。** 否决：那会惩罚在 10Hz 下渲染毫无压力的短回复；成本随气泡长度增长，间隔也应如此。

**只用右键上下文菜单。** 否决：参照产品（Grok Bot）在气泡旁以悬停展示操作；可发现性正是需求的核心。

## Consequences

**得到的**：头部条之外处处可以选择文本；每条完成的消息都有悬停复制入口；任意长度的流都让主线程跑在自身排版工作之前。

**付出的**：markdown 格式只在流式消息完成后出现；拖动窗口必须使用头部条。

## Testing

`testStreamRenderIntervalScalesWithLength` 固定间隔阈值；合并测试固定 chunk 与持久事件的 bump 行为。悬停展示与拖动区域属视图层接线，在运行中的应用里验证。
