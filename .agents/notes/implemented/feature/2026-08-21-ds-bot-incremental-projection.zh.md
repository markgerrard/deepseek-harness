# Agent Note: DS Bot 增量折叠会话事件并跳过逐 chunk 持久化

Status: implemented

[English](2026-08-21-ds-bot-incremental-projection.md) | 中文

## Problem

每个会话事件都会重投影完整事件列表（每次更新对全部事件跑 `projectTranscript`）并把完整会话记录重写到磁盘，因此流式聊天每个增量都付出 O(事件数) 的 CPU 和一次完整序列化写盘——随对话呈二次方增长，也是呈现窗口上限落地后剩余的主要成本。

## Decision

`TranscriptProjector` 持有折叠状态（条目、chunk 缓冲、进行中工具、进行中工作流、流式轮次）：`ingest(event)` 就地折叠一个事件，`materialize(expansion:)` 返回可呈现条目——折叠列表叠加展开标志，再加上进行中的流式尾部。折叠条目存储 `expanded: false`；展开是 materialize 时的叠加层，因此切换卡片永不重新折叠事件。条目更新走 id→下标映射而不是尾部扫描。`projectTranscript` 保留为一次性包装（全部折叠、一次 materialize），既有调用方和测试行为不变。`SessionController` 为每个会话保留一个投影器：`appendEvent` 只折叠新事件，`setEvents` 在水合时一次性重建投影器，`assistant/chunk` 事件跳过 `persistTranscript`——下一个持久事件写出完整列表，崩溃只丢失未定稿的流。

## Alternatives considered

**缓存投影数组并在展开变化时失效。** 否决：切换展开会重新折叠整个事件列表；叠加层让展开与折叠正交。

**用定时器去抖持久化。** 否决：定时器为同样的效果引入生命周期（销毁时冲刷、取消）；按事件持久性判断是无状态的，并准确命名了风险所在。

## Consequences

**得到的**：一个流式 chunk 只花一次缓冲更新且不写盘；长对话中的打开、切换卡片和流式输出的每次更新成本不再随对话长度增长。

**付出的**：`materialize` 每次读取仍复制折叠条目数组（写时复制的 memcpy，无解析），`eventsBySession` 为持久化和 seq 查询与投影器并存保留原始事件列表。

## Testing

既有 `TranscriptProjectionTests` 经一次性包装固定折叠行为；`SessionControllerTests` 覆盖追加/水合路径及投影器之上的呈现窗口；`TranscriptStoreTests.testControllerReloadsPersistedTranscript` 覆盖持久化往返。
