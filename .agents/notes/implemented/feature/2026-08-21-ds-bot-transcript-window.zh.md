# Agent Note: DS Bot 以有上限的窗口呈现会话记录并支持回滚分页

Status: implemented

[English](2026-08-21-ds-bot-transcript-window.md) | 中文

## Problem

DS Bot 的长对话在流式输出时会变慢：聊天视图呈现完整投影的会话记录，每个会话事件都会重建并重新 diff 整个条目数组，打开旧对话也会一次渲染全部历史。投影本身同样每次更新都重投影全部事件，但立即可感的成本是无界的呈现集合。

## Decision

`SessionController.presentedChat` 将每个线程呈现的条目限制为最新的 `transcriptWindowSize`（120）条，且在存在更早条目时设置 `PresentedChat.hasEarlier`。`loadEarlierItems()` 将所选线程的窗口扩大一页。聊天视图打开时锚定底部，仅在存在更早条目时显示顶部哨兵，哨兵滚入视野时惰性分页（重新锚定先前的首条目，避免视口跳动）；自动滚动改为以最后一个条目的标识为键，因此分页载入更早条目不会把视图拽到底部。完整投影仍留在内存中；上限约束的是 SwiftUI 的 diff 与行实体化，不是事件保留。

## Alternatives considered

**在水合时截断（只加载尾部事件）。** 本步骤否决：投影会折叠事件对（chunk 折叠进消息、工具调用配对结果），事件级截断需要安全的轮次边界；条目级窗口天然正确。

**改做增量投影。** 互补，刻意排为第二步：它消除每个流式 chunk 的 O(事件数) 重投影，而本变更约束每次更新的渲染集合；二者解决的是不同的成本。

## Consequences

**得到的**：长对话打开时锚定底部，至多渲染一个窗口的行，更新时的 diff 由窗口而非对话长度约束。

**付出的**：`presentedChat` 在加窗前仍投影完整事件列表，增量投影落地前每事件的 CPU 成本仍在。线程扩大后的窗口只在控制器生命周期内保持。

## Testing

`SessionControllerTests.testPresentedChatCapsItemsAndPagesEarlier` 固定了上限、`hasEarlier`、窗口的最新后缀内容，以及分页到完整的行为。
